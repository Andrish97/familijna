"""Która rola usługi wymaga restartu po zmianie plików (stdin: ścieżki z git diff).
Wypisuje: leads | questions | both | none. Plan: familijna-server/docs/wyszukiwarka-podzial-plan.md."""
import sys

BASE = 'services/lead-finder/'
QUESTIONS_ONLY = {'lf/question_bank.py'}
LEADS_ONLY = {'lf/pipeline.py', 'lf/classify.py', 'lf/fetch.py', 'lf/sources/ceidg.py',
              'ai_prompt.txt', 'ai_category_prompt.txt', 'ai_more_queries_prompt.txt', 'subpage_paths.txt'}
# Nie trafiają do obrazu (tests wykluczone z rsync, ten plik — tylko dla workflow).
IGNORED_PREFIXES = ('tests/', 'README', 'deploy_role.py')


def role(paths):
    leads = questions = False
    for p in paths:
        p = p.strip()
        if not p.startswith(BASE):
            continue
        rel = p[len(BASE):]
        if rel.startswith(IGNORED_PREFIXES):
            continue
        if rel in QUESTIONS_ONLY:
            questions = True
        elif rel in LEADS_ONLY:
            leads = True
        else:
            leads = questions = True
    return 'both' if leads and questions else 'leads' if leads else 'questions' if questions else 'none'


if __name__ == '__main__':
    print(role(sys.stdin.read().splitlines()))
