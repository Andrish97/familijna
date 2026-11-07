import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from deploy_role import role  # noqa: E402

B = 'services/lead-finder/'


class DeployRoleTest(unittest.TestCase):
    def test_roles(self):
        self.assertEqual(role([B + 'lf/question_bank.py']), 'questions')
        self.assertEqual(role([B + 'lf/pipeline.py', B + 'ai_prompt.txt']), 'leads')
        self.assertEqual(role([B + 'lf/pipeline.py', B + 'lf/question_bank.py']), 'both')
        self.assertEqual(role([B + 'lf/resources.py']), 'both')
        self.assertEqual(role([B + 'main.py']), 'both')
        self.assertEqual(role([B + 'Dockerfile']), 'both')
        self.assertEqual(role([B + 'tests/test_x.py', B + 'deploy_role.py']), 'none')
        self.assertEqual(role([]), 'none')


if __name__ == '__main__':
    unittest.main()
