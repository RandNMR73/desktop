from pathlib import Path
import importlib.util
import json
root = Path(__file__).parent
spec = importlib.util.spec_from_file_location('fixture', str(root / 'fixture-base.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.fixtures = root / 'fixture-proposals'
fixture.cases = tuple(case['name'] for case in json.loads((root / 'manifest.json').read_text())['cases'])
fixture.main()
