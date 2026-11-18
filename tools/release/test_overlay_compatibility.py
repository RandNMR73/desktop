"""Producer-side no-op contract coverage; no packaging or browser execution."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
from unittest.mock import patch
from test_export_resource import Fixture
import zipfile
import export_resource as export


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.app=Path(self.tmp.name)/'Zen.app';(self.app/'Contents/Resources').mkdir(parents=True)
        (self.app/'Contents/Resources/platform.ini').write_text('[Build]\nSourceStamp='+'a'*40+'\n')
        self.files={'Contents/MacOS/libzen-app-icons.dylib':'f'*64}
        self.seed={'version':1,'repository':'RandNMR73/desktop','baselineRevision':'b'*40,'catalogSourceRevision':'c'*40,
                   'engineRevision':'d'*40,'sourceStamp':'a'*40,'scopes':{}}
        self.provenance={'engineRevision':'d'*40,'optionalNativeLibrary':{'sha256':'e'*64}}
        for scope,archive in [('browser',export.CORE[1]),('root',export.CORE[2])]:
            path=self.app/archive;path.parent.mkdir(exist_ok=True,parents=True)
            with zipfile.ZipFile(path,'w') as z:z.writestr('member',b'current reviewed bytes')
            self.files[archive]=export.sha256(path)
            self.seed['scopes'][scope]={'archive':archive,'catalogSHA256':'1'*64,
                'patches':{'0001-known.patch':'2'*64},'members':['member','absent']}

    def make(self):return export.overlay_compatibility(self.seed,'3'*64,self.app,self.provenance,self.files)

    def test_emitted_hashes_are_actual_bytes_and_explicit_absence(self):
        output=self.make()
        self.assertEqual(output['scopes']['root']['members'],{'member':export.data_sha(b'current reviewed bytes'),'absent':None})
        self.assertEqual(output['scopes']['browser']['archiveSHA256'],self.files[export.CORE[1]])
        self.assertEqual(output['nativeHelpers'],{'libzen-native-theme.dylib':'e'*64,'libzen-app-icons.dylib':'f'*64})
        self.assertEqual(output['kind'],'no-op-source-overlays')
        self.assertNotIn(str(self.app),json.dumps(output))

    def test_unsupported_engine_repository_or_stamp_is_rejected(self):
        for key,value in [('engineRevision','e'*40),('repository','other/fork'),('sourceStamp','f'*40)]:
            old=self.seed[key];self.seed[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):self.make()
            self.seed[key]=old

    def test_incomplete_unsafe_or_duplicate_coverage_is_rejected(self):
        for names in [[],['../outside'],['member','member']]:
            self.seed['scopes']['root']['members']=names
            with self.subTest(names=names),self.assertRaises(ValueError):self.make()
        del self.seed['scopes']['root']
        with self.assertRaisesRegex(ValueError,'Incomplete'):self.make()

    def test_wrong_archive_and_unreviewed_patch_identity_are_rejected(self):
        self.seed['scopes']['root']['archive']=export.CORE[1]
        with self.assertRaisesRegex(ValueError,'archive/catalog'):self.make()
        self.seed['scopes']['root']['archive']=export.CORE[2]
        self.seed['scopes']['root']['patches']={'../code.py':'a'*64}
        with self.assertRaisesRegex(ValueError,'patch map'):self.make()


class IntegratedContractTests(unittest.TestCase):
    def test_export_revision_is_distinct_from_later_integration_ref_witness(self):
        with tempfile.TemporaryDirectory() as temp:
            f=Fixture(Path(temp))
            for app in (f.base_app,f.app,f.final_app):
                (app/'Contents/Resources/platform.ini').write_text('[Build]\nSourceStamp='+'a'*40+'\n')
                (app/'Contents/MacOS/libzen-app-icons.dylib').write_bytes(b'icons')
            seed={'version':1,'repository':'RandNMR73/desktop','baselineRevision':f.target,
                  'catalogSourceRevision':f.frontend,'engineRevision':f.base,'sourceStamp':'a'*40,'scopes':{}}
            for scope,path,members in [('browser',export.CORE[1],['foo.mjs']),('root',export.CORE[2],['keep'])]:
                seed['scopes'][scope]={'archive':path,'catalogSHA256':'1'*64,'patches':{'0001-known.patch':'2'*64},'members':members}
            f.put(export.OVERLAY_BASELINE,json.dumps(seed))
            exported=f.commit('reviewed overlay baseline')
            f.args.revision=exported
            f.put('README.md','later integration witness')
            witness=f.commit('later documentation')
            f.git('update-ref','refs/remotes/origin/astral',witness)
            f.terminal['baselineFiles']=export.inventory(f.base_app)
            f.terminal['files']=export.inventory(f.app)
            f.child['files']=export.inventory(f.final_app)
            f.save()
            real=subprocess.run
            def run(argv,**kwargs):
                if Path(argv[0]).name=='codesign':return subprocess.CompletedProcess(argv,0)
                return real(argv,**kwargs)
            with patch.object(export.subprocess,'run',side_effect=run):
                *_,provenance=export.preflight(f.args)
            self.assertEqual(provenance['sourceEquivalence']['integrationRevision'],exported)
            self.assertEqual(provenance['sourceEquivalence']['integrationRefRevision'],witness)
            self.assertEqual(provenance['overlayCompatibility']['baselineRevision'],seed['baselineRevision'])
            self.assertEqual(provenance['overlayCompatibility']['scopes']['browser']['members']['foo.mjs'],export.data_sha(b'frontend'))


if __name__=='__main__':unittest.main()
