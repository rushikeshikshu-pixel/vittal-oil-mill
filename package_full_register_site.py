from pathlib import Path
import json, shutil, tarfile, hashlib, sys
suffix = sys.argv[1] if len(sys.argv)>1 else ''
assert suffix in ['', '-v5']
root=Path('sites/ikshu-intelligence')
stage=Path('outputs/ikshu-website/package-full-register-161'+suffix+'/dist')
meta=stage/'.openai'
meta.mkdir(parents=True,exist_ok=True)
source=json.loads((root/'.openai/hosting.json').read_text(encoding='utf-8'))
built_path=root/'dist/.openai/hosting.json'
built=json.loads(built_path.read_text(encoding='utf-8')) if built_path.exists() else {}
if source.get('artifact_metadata') and built.get('artifact_metadata'):
    assert source['artifact_metadata']==built['artifact_metadata']
if built.get('artifact_metadata') is not None:
    source['artifact_metadata']=built['artifact_metadata']
(meta/'hosting.json').write_text(json.dumps(source,indent=2)+'\n',encoding='utf-8')
shutil.copytree(root/'drizzle',meta/'drizzle',dirs_exist_ok=True)
archive=Path('outputs/ikshu-website/site-full-register-161'+suffix+'.tar.gz')
assert source['project_id']=='appgprj_6acba96c31848191aaa673f2193b1cd4'
assert (stage/'server/index.js').is_file()
with tarfile.open(archive,'w:gz') as f:
    f.add(stage,arcname='dist')
with tarfile.open(archive) as f:
    entries=f.getnames()
assert 'dist/.openai/hosting.json' in entries
assert 'dist/server/index.js' in entries
assert not any('/.env' in p or '/full-register/' in p for p in entries)
print(json.dumps({'archive':str(archive.resolve()),'files':len(entries),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
