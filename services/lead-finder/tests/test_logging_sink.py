import asyncio
import logging
import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lf.logging_sink import DbLogHandler, describe_error
from lf.pipeline import Engine


class LoggingTest(unittest.IsolatedAsyncioTestCase):
    async def test_warnings_and_application_db_errors_are_visible_without_recursion(self):
        db = SimpleNamespace(insert=AsyncMock(return_value=[]))
        handler = DbLogHandler(db)
        for level, message in [(logging.WARNING, 'Usługa zwolniła'), (logging.ERROR, 'DB insert marketing_verified_contacts: 409')]:
            record = logging.LogRecord('lead_finder', level, __file__, 1, message, (), None)
            handler.emit(record)
        handler.emit(logging.LogRecord('lead_finder', logging.ERROR, __file__, 1, 'DB insert marketing_search_logs: 503', (), None))
        await asyncio.sleep(0)
        self.assertEqual(db.insert.await_count, 2)
        self.assertEqual([call.args[1]['level'] for call in db.insert.await_args_list], ['warning', 'error'])

    async def test_empty_timeout_has_type_and_description_and_full_error_context(self):
        db = SimpleNamespace(insert=AsyncMock(return_value=[]))
        handler = DbLogHandler(db)
        self.assertIn('ReadTimeout', describe_error(httpx.ReadTimeout('')))
        self.assertIn('przekroczono czas', describe_error(httpx.ReadTimeout('')))
        self.assertIn('ValueError', describe_error(ValueError()))
        logger = logging.getLogger('lead_finder.test')
        logger.addHandler(handler)
        try:
            try:
                raise httpx.ReadTimeout('')
            except httpx.ReadTimeout as error:
                logger.error('CEIDG: %s\n%s', describe_error(error), 'context' * 500, exc_info=True)
            await asyncio.sleep(0)
        finally:
            logger.removeHandler(handler)
        message = db.insert.await_args.args[1]['message']
        self.assertIn('ReadTimeout', message)
        self.assertIn('Traceback', message)
        self.assertGreater(len(message), 2000)

    async def test_new_run_keeps_recent_logs_and_removes_only_older_than_seven_days(self):
        db = SimpleNamespace(delete=AsyncMock(), rpc=AsyncMock(return_value=True))
        engine = Engine(db, None, 'http://search.test')
        engine.run_search = AsyncMock()
        engine.save_stats = AsyncMock()
        with patch('lf.pipeline.asyncio.sleep', new=AsyncMock()):
            await engine.run_claimed({'run_id': 'run-id', 'target': 1, 'verified': 0, 'resumed': 0, 'status': 'running'}, 'lease')
        table, filters = db.delete.await_args.args
        self.assertEqual(table, 'marketing_search_logs')
        self.assertEqual(set(filters), {'created_at'})
        self.assertTrue(filters['created_at'].startswith('lt.'))
        cutoff = datetime.fromisoformat(filters['created_at'][3:])
        age = (datetime.now(timezone.utc) - cutoff).total_seconds()
        self.assertGreater(age, 6.9 * 86400)
        self.assertLess(age, 7.1 * 86400)

    async def test_ceidg_timeout_records_the_exception_type_and_trace(self):
        ceidg = SimpleNamespace(enabled=True, list_firms=AsyncMock(side_effect=httpx.ReadTimeout('')))
        engine = Engine(None, None, 'http://search.test', ceidg=ceidg)
        engine.status, engine.target = 'running', 1
        engine.categories = [{'id': 'cat', 'pkd': ['93.29.Z']}]
        with self.assertLogs('lead_finder', logging.ERROR) as captured, patch('lf.pipeline.asyncio.sleep', new=AsyncMock()):
            await asyncio.wait_for(engine.ceidg_producer(), 5)
        self.assertIn('CEIDG 93.29.Z s. 1: ReadTimeout:', captured.output[0])
        self.assertIsNone(captured.records[0].exc_info)
        # Jedno ponowienie w przebiegu, potem pominięcie — bez nieskończonej pętli.
        self.assertEqual(engine.stats['errors'], 2)
        self.assertIn('pomijam do następnego przebiegu', captured.output[-1])


if __name__ == '__main__':
    unittest.main()
