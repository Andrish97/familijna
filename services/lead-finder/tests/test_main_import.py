"""Moduł main.py musi się importować (start usługi). 2026-11-08: po usunięciu
Telegrama został odnośnik do usuniętej funkcji notify — kontener był
niezdrowy, a testy tego nie wykryły. Import w osobnym procesie (aplikacja
startuje zadania w tle)."""
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class MainImportTest(unittest.TestCase):
    def test_main_imports(self):
        env = {**os.environ, 'SUPABASE_URL': 'http://localhost', 'SUPABASE_SERVICE_ROLE_KEY': 'test', 'LEAD_FINDER_API_KEY': 'test'}
        r = subprocess.run([sys.executable, '-c', 'import main'], cwd=ROOT, env=env,
                           capture_output=True, text=True, timeout=60)
        if 'ModuleNotFoundError' in r.stderr:
            self.skipTest('brak zależności usługi')
        self.assertEqual(r.returncode, 0, r.stderr[-800:])


if __name__ == '__main__':
    unittest.main()
