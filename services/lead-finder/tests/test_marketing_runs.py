"""Przebieg Marketingu w bazie (migracja 519): python3 -m unittest tests/test_marketing_runs.py"""
import asyncio
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from lf.pipeline import Engine  # noqa: E402


def make_engine(rpc_result=True):
    db = SimpleNamespace(delete=AsyncMock(), rpc=AsyncMock(return_value=rpc_result),
                         select=AsyncMock(return_value=[{'search_queries': 5, 'errors': 1}]))
    engine = Engine(db, None, 'http://search.test')
    engine.save_stats = AsyncMock()
    return engine, db


def finish_call(db):
    return [c for c in db.rpc.await_args_list if c.args[0] == 'mk_run_finish'][-1].args[1]


class MarketingRunTest(unittest.IsolatedAsyncioTestCase):
    async def test_new_run_completes_and_finishes_in_db(self):
        engine, db = make_engine()
        engine.run_search = AsyncMock()
        with patch('lf.pipeline.asyncio.sleep', new=AsyncMock()):
            await engine.run_claimed({'run_id': 'r1', 'target': 10, 'verified': 0, 'resumed': 0, 'status': 'running'}, 'L1')
        self.assertEqual(finish_call(db), {'p_run': 'r1', 'p_lease': 'L1', 'p_status': 'completed', 'p_verified': 0})
        db.delete.assert_awaited()  # nowy przebieg czyści stare logi
        self.assertEqual(engine.status, 'idle')

    async def test_resumed_run_keeps_counter_target_and_stats(self):
        engine, db = make_engine()
        seen = {}

        async def run_search(target):
            seen['target'], seen['verified'] = target, engine.verified
            engine.verified = 10
        engine.run_search = run_search
        with patch('lf.pipeline.asyncio.sleep', new=AsyncMock()):
            await engine.run_claimed({'run_id': 'r1', 'target': 10, 'verified': 7, 'resumed': 1, 'status': 'running'}, 'L2')
        self.assertEqual(seen, {'target': 10, 'verified': 7})
        self.assertEqual(engine.stats['search_queries'], 5)  # liczniki sprzed restartu
        db.delete.assert_not_awaited()  # wznowienie nie czyści logów
        self.assertEqual(finish_call(db)['p_status'], 'completed')
        self.assertEqual(finish_call(db)['p_verified'], 10)

    async def test_cancel_from_panel_seen_by_heartbeat(self):
        engine, db = make_engine(rpc_result='cancel_requested')
        engine.BEAT_EVERY = 0.01

        async def run_search(target):
            while True:
                await engine._checkpoint()
                await asyncio.sleep(0.01)
        engine.run_search = run_search
        real_sleep = asyncio.sleep
        with patch('lf.pipeline.asyncio.sleep', new=lambda s: real_sleep(min(s, 0.01))):
            await asyncio.wait_for(engine.run_claimed({'run_id': 'r1', 'target': 5, 'verified': 0, 'resumed': 0, 'status': 'running'}, 'L'), 5)
        self.assertEqual(finish_call(db)['p_status'], 'cancelled')

    async def test_lost_lease_stops_without_finishing(self):
        engine, db = make_engine(rpc_result=None)
        engine.BEAT_EVERY = 0.01

        async def run_search(target):
            while True:
                await engine._checkpoint()
                await asyncio.sleep(0.01)
        engine.run_search = run_search
        real_sleep = asyncio.sleep
        with patch('lf.pipeline.asyncio.sleep', new=lambda s: real_sleep(min(s, 0.01))):
            await asyncio.wait_for(engine.run_claimed({'run_id': 'r1', 'target': 5, 'verified': 0, 'resumed': 0, 'status': 'running'}, 'L'), 5)
        self.assertFalse([c for c in db.rpc.await_args_list if c.args[0] == 'mk_run_finish'])
        self.assertEqual(engine.status, 'idle')

    async def test_supervise_claims_run(self):
        engine, db = make_engine()
        runs = [{'run_id': 'r9', 'target': 3, 'verified': 0, 'resumed': 0, 'status': 'running'}]

        async def rpc(fn, params=None):
            if fn == 'mk_run_claim':
                return runs.pop(0) if runs else None
            return True
        db.rpc = rpc
        claimed = asyncio.Event()

        async def run_claimed(run, lease):
            self.assertEqual(run['run_id'], 'r9')
            claimed.set()
        engine.run_claimed = run_claimed
        task = asyncio.create_task(engine.supervise())
        await asyncio.wait_for(claimed.wait(), 2)
        task.cancel()

    async def test_service_stop_releases_lease_without_finishing(self):
        engine, db = make_engine()
        started = asyncio.Event()

        async def run_search(target):
            engine.verified = 4
            started.set()
            await asyncio.sleep(3600)
        engine.run_search = run_search
        task = asyncio.create_task(engine.run_claimed({'run_id': 'r1', 'target': 9, 'verified': 0, 'resumed': 0, 'status': 'running'}, 'L'))
        await asyncio.wait_for(started.wait(), 2)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        names = [c.args[0] for c in db.rpc.await_args_list]
        self.assertNotIn('mk_run_finish', names)
        release = [c.args[1] for c in db.rpc.await_args_list if c.args[0] == 'mk_run_release'][-1]
        self.assertEqual(release, {'p_run': 'r1', 'p_lease': 'L', 'p_verified': 4})
        self.assertEqual(engine.status, 'idle')


if __name__ == '__main__':
    unittest.main()
