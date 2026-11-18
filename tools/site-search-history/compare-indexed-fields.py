"""Compare two completed packaged-history validations without launching a browser."""
from pathlib import Path
import argparse
import hashlib
import json


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--baseline', type=Path, required=True)
p.add_argument('--candidate', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
assert not a.output.exists(), 'Preserve previous comparison receipts'
baseline, candidate = [json.loads(path.read_text()) for path in (a.baseline, a.candidate)]
assert baseline['passed'] and candidate['passed']
assert baseline['fixtureNow'] == candidate['fixtureNow']
checks = {}
for key, count in [('model', 965), ('locale', 21), ('pipeline', 8), ('deletedRows', 4)]:
    left, right = baseline['validation'][key], candidate['validation'][key]
    checks[key] = len(left) == len(right) == count and left == right

# Require a meaningful provider result, not merely two equally empty snapshots.
pipeline = candidate['validation']['pipeline']
checks['historyAutofillPresent'] = (
    pipeline[0]['state']['values'][0]['payload']['suggestion'] == 'lattice compiler'
    and pipeline[0]['state']['selection'] == {
        'value': 'lattice compiler', 'start': 7, 'end': 16, 'index': 0})
checks['deletionChangesResults'] = (
    pipeline[-1]['phase'] == 'after-delete'
    and pipeline[-1]['state']['values'] != pipeline[0]['state']['values']
    and all(row['payload']['suggestion'] != 'lattice compiler'
            for row in pipeline[-1]['state']['values']))
checks['supersededQueryOnly'] = (
    pipeline[-2]['phase'] == 'superseded'
    and pipeline[-2]['state']['query'] == 'lattice missing'
    and [row['payload']['suggestion'] for row in pipeline[-2]['state']['values']]
        == ['lattice missing'])
checks['packagedSourcesDiffer'] = (
    baseline['validation']['runtime']['sourceSHA256']
    != candidate['validation']['runtime']['sourceSHA256'])

summary = {
    'passed': all(checks.values()),
    'checks': checks,
    'inputSHA256': {str(path.resolve()): sha(path) for path in (a.baseline, a.candidate, Path(__file__))},
    'fixtureNow': baseline['fixtureNow'],
    'comparisonCounts': {'functionCases': 965, 'actualSQLiteLocaleQueries': 21,
                         'fullProviderStates': 8, 'remainingRowsAfterDeletion': 4},
    'limits': candidate['limits'],
    'maxChargedAllocatedBytes': max(sample['chargedAllocatedBytes'] for run in (baseline, candidate) for sample in run['samples']),
    'minObservedFreeBytes': min(sample['freeBytes'] for run in (baseline, candidate) for sample in run['samples']),
    'runtimeIntegrity': {name: {key: run[key] for key in (
        'browserExitCode', 'profileRemoved', 'inputsUnchanged', 'appUnchanged',
        'cloneUnchanged', 'signatureAfter', 'guardFailures')}
        for name, run in [('baseline', baseline), ('candidate', candidate)]},
    'limitations': [
        'Functional comparison only; no timing or native visual claim.',
        'Each app used a separate fresh owned profile with the same synthetic timestamps.',
        'No production method/source injection; resource resolution, module hash and imported function source were checked.',
        'Charged allocation excludes verified unchanged clonefile app files; it is not an APFS physical extent measurement.',
        'Network protection uses fresh-profile proxy preferences, not an operating-system firewall.',
    ],
}
a.output.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'passed': summary['passed'], 'checks': checks}))
raise SystemExit(0 if summary['passed'] else 1)
