/**
 * Quiet Spaces self-hosted OTA release helper.
 * Use "prepare VERSION" before Capgo CLI zips the staged www directory,
 * then "finalize VERSION ZIPFILE" to prepare manifest and published ZIP.
 */
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';

const [mode,version,zipPath] = process.argv.slice(2);
const root = process.cwd();
const VERSION_PATTERN=/^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const manifestPath=join(root,'ota','latest.json');
const stagedVersion=join(root,'www','app-version.js');
function numbers(v){return v.split('.').map(Number);}
function newer(a,b){
 const x=numbers(a),y=numbers(b);
 for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}
 return false;
}
async function validate(){
 if(!VERSION_PATTERN.test(version||''))throw Error('Release version must be X.Y.Z');
 const current=JSON.parse(await readFile(manifestPath,'utf8'));
 const baseline=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
 if(!VERSION_PATTERN.test(baseline)||!VERSION_PATTERN.test(current.version))
   throw Error('Invalid baseline or published version');
 if(!newer(version,baseline)||!newer(version,current.version))
   throw Error('OTA version must be newer than the native baseline and previous release.');
 if(current.nativeRevision!==1)throw Error('Native revision changed: requires a new APK');
 return current;
}
async function main(){
 if(mode!=='prepare'&&mode!=='finalize')throw Error('Expected prepare or finalize');
 await validate();
 if(mode==='prepare'){
   const content=await readFile(stagedVersion,'utf8');
   const needle=/globalThis\.QuietSpacesVersion = '\d+\.\d+\.\d+';/;
   if(!needle.test(content))throw Error('Cannot locate app version in staged bundle');
   await writeFile(stagedVersion,content.replace(needle,
      "globalThis.QuietSpacesVersion = '"+version+"';"),'utf8');
   console.log('Prepared staged OTA web bundle version',version);
   return;
 }
 if(!zipPath)throw Error('Capgo ZIP path required');
 const filename='quiet-spaces-v'+version+'.zip';
 const folder=join(root,'ota','releases');
 await mkdir(folder,{recursive:true});
 const target=join(folder,filename);
 if(resolve(zipPath)===target)throw Error('ZIP must be generated outside ota/releases');
 const bytes=await readFile(resolve(zipPath));
 if(bytes.length<5000||bytes.subarray(0,2).toString()!=='PK')
   throw Error('Expected a nonempty Capgo-format ZIP');
 const digest=createHash('sha256').update(bytes).digest('hex');
 await copyFile(resolve(zipPath),target);
 const notes=(process.env.RELEASE_NOTES||'Quiet Spaces improvements.').slice(0,240);
 const manifest={
   version,nativeRevision:1,
   url:'https://jeandhi-pixel.github.io/Quiet-pages/ota/releases/'+filename,
   checksum:digest,notes
 };
 await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n','utf8');
 console.log('Prepared public update manifest:',JSON.stringify(manifest,null,2));
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
