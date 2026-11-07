"""Wspólne bramki usług (migracja 518): python3 -m unittest tests/test_shared_gate.py
Test na prawdziwej bazie tylko z SVC_SLOTS_PSQL (np. "psql -h /var/tmp/pgfam -p 5499 -U postgres -d t518")."""
import asyncio
import json
import os
import shlex
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from lf import resources  # noqa: E402


class FakeDb:
    def __init__(self, acquire_results):
        self.acquire_results = list(acquire_results)
        self.calls = []

    async def rpc(self, fn, params=None):
        self.calls.append((fn, params))
        if fn == 'svc_slot_acquire':
            return self.acquire_results.pop(0) if self.acquire_results else 'h-last'
        if fn == 'svc_cooldown_left':
            return 0
        return True


class PsqlDb:
    """Wywołania RPC przez psql na lokalnej bazie z migracją 518."""
    def __init__(self, cmd):
        self.cmd = shlex.split(cmd)

    async def rpc(self, fn, params=None):
        args = ', '.join(f"p_{k[2:]} => {self._lit(v)}" if k.startswith('p_') else '' for k, v in (params or {}).items())
        sql = f"select to_jsonb(public.{fn}({args}))"
        proc = await asyncio.create_subprocess_exec(*self.cmd, '-AtXq', '-c', sql, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await proc.communicate()
        if proc.returncode:
            raise RuntimeError(err.decode())
        return json.loads(out.decode().strip() or 'null')

    @staticmethod
    def _lit(v):
        return str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"


class SharedGateTest(unittest.TestCase):
    def tearDown(self):
        resources.bind_db(None)

    def test_waits_until_slot_then_releases(self):
        db = FakeDb([None, None, 'h1'])
        resources.bind_db(db)
        gate = resources.SharedGate('search', 2)

        async def run():
            async with gate.slot('marketing'):
                return 'inside'
        self.assertEqual(asyncio.run(run()), 'inside')
        names = [c[0] for c in db.calls]
        self.assertEqual(names.count('svc_slot_acquire'), 3)
        self.assertEqual(db.calls[-1], ('svc_slot_release', {'p_holder': 'h1'}))

    def test_releases_on_error(self):
        db = FakeDb(['h2'])
        resources.bind_db(db)
        gate = resources.SharedGate('ai', 1)

        async def run():
            async with gate.slot('questions'):
                raise ValueError('x')
        with self.assertRaises(ValueError):
            asyncio.run(run())
        self.assertEqual(db.calls[-1], ('svc_slot_release', {'p_holder': 'h2'}))

    def test_cooldown_shared_through_db(self):
        db = FakeDb([])
        resources.bind_db(db)
        resources._provider_until = 0.0
        asyncio.run(resources._cooldown(60))
        self.assertIn(('svc_cooldown_set', {'p_resource': 'ai', 'p_seconds': 60}), db.calls)
        resources._provider_until = 0.0


@unittest.skipUnless(os.getenv('SVC_SLOTS_PSQL'), 'bez lokalnej bazy z migracją 518')
class SharedGatePostgresTest(unittest.TestCase):
    def test_two_services_never_exceed_capacity(self):
        resources.bind_db(PsqlDb(os.environ['SVC_SLOTS_PSQL']))
        # Osobne bramki = osobne procesy (każdy z własnym FairGate), wspólna baza.
        gates = {'marketing': resources.SharedGate('search', 2), 'questions': resources.SharedGate('search', 2)}
        state = {'now': 0, 'max': 0, 'done': {'marketing': 0, 'questions': 0}}

        async def worker(owner):
            for _ in range(4):
                async with gates[owner].slot(owner):
                    state['now'] += 1
                    state['max'] = max(state['max'], state['now'])
                    await asyncio.sleep(0.3)
                    state['now'] -= 1
                    state['done'][owner] += 1

        async def run():
            await asyncio.gather(*(worker(o) for o in ('marketing', 'marketing', 'questions', 'questions')))
        try:
            asyncio.run(run())
        finally:
            resources.bind_db(None)
        self.assertLessEqual(state['max'], 2)
        self.assertEqual(state['done'], {'marketing': 8, 'questions': 8})


if __name__ == '__main__':
    unittest.main()
