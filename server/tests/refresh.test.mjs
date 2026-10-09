import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const source = await readFile(new URL('../locationBot.js', import.meta.url), 'utf8');
const testDirectory = await mkdtemp(join(tmpdir(), 'lifefood-refresh-'));
const mockFile = join(testDirectory, 'bot.mjs');
await writeFile(mockFile, source.replace("import { FieldValue, FieldPath } from 'firebase-admin/firestore';", "const FieldValue = globalThis.__FieldValue; const FieldPath = globalThis.__FieldPath;").replace("import { getDb } from './firebase.js';", "const getDb = globalThis.__getDb;"));
const records = new Map();
const sent = [];
const apiMethods = [];
const makeDoc = (name,id) => ({id,get: async () => ({exists:records.has(name+'/'+id),data:()=>records.get(name+'/'+id)}),set:async (data,options)=>records.set(name+'/'+id,{...(options?.merge?records.get(name+'/'+id):{}),...data})});
class Query {
  constructor(name){this.name=name;this.count=Infinity;this.cursor='';}
  doc(id){return makeDoc(this.name,id);}
  orderBy(){return this;}
  limit(n){this.count=n;return this;}
  startAfter(doc){this.cursor=doc.id;return this;}
  async get(){
    const docs=[...records.entries()].filter(([key])=>key.startsWith(this.name+'/')).map(([key,value])=>({id:key.slice(this.name.length+1),data:()=>value})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).filter(doc=>doc.id>this.cursor).slice(0,this.count);
    return {docs,empty:docs.length===0,size:docs.length};
  }
}
const db={collection:name=>new Query(name),runTransaction:async callback=>callback({get:ref=>ref.get(),set:(ref,data,options)=>ref.set(data,options)})};
process.env.BOT_TOKEN='unit-test-only';
process.env.MINI_APP_URL='https://abrorzip.github.io/Life-Food/';
process.env.TELEGRAM_WEBHOOK_SECRET='test-webhook-secret';
delete process.env.BOT_REFRESH_CODE;
globalThis.__FieldValue={serverTimestamp:()=>new Date()};
globalThis.__FieldPath={documentId:()=>'__name__'};
globalThis.__getDb=()=>db;
globalThis.fetch=async (url,options)=>{
 const method=url.split('/').at(-1); const body=JSON.parse(options.body); apiMethods.push({method,body});
 if(method==='getWebhookInfo') return {ok:true,json:async()=>({ok:true,result:{url:'https://life-food-phi.vercel.app/api/telegram/webhook',allowed_updates:['message'],max_connections:40}})};
 if(method==='sendMessage'){
   if(body.chat_id===3) return {ok:false,json:async()=>({ok:false})};
   sent.push(body);
 }
 return {ok:true,json:async()=>({ok:true,result:{message_id:sent.length}})};
};
const realTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>realTimeout(fn,Math.min(ms,1),...args);
const {handleUpdate}=await import(pathToFileURL(mockFile).href);
const message=(id,text,extra={})=>({message:{chat:{id,type:'private'},from:{id,first_name:'Test'},text,...extra}});
const click=id=>({callback_query:{id:'callback-'+id,data:'refresh_apps',from:{id},message:{chat:{id,type:'private'}}}});
function checkMenu(reply){
 const buttons=reply.reply_markup.inline_keyboard.flat();
 assert.equal(buttons.filter(b=>b.web_app).length,2);
 assert.equal(buttons[0].web_app.url,'https://abrorzip.github.io/Life-Food/');
 assert.equal(buttons[1].web_app.url,'https://life-food-phi.vercel.app/miniapp/');
 assert.equal(buttons[2].callback_data,'refresh_apps');
}
await handleUpdate(message(1,'/start'));
checkMenu(sent.at(-1));
assert.ok(apiMethods.find(item=>item.method==='setWebhook'&&item.body.allowed_updates.includes('callback_query')&&!item.body.drop_pending_updates));
records.set('profiles/2',{telegramUserId:2,state:'complete',complete:true});
records.set('profiles/3',{telegramUserId:3,state:'complete',complete:true});
records.set('profiles/4',{telegramUserId:4,state:'surname',complete:false});
await handleUpdate(click(1));
assert.ok(sent.at(-1).text.includes('kodini kiriting'));
const beforeBad=sent.length;
await handleUpdate(message(1,'9999'));
assert.equal(sent.length,beforeBad+1);
assert.ok(sent.at(-1).text.includes('noto‘g‘ri'));
assert.equal(records.get('profiles/1').state,'name');
const beforeGood=sent.length;
await handleUpdate(message(1,'1234'));
const broadcast=sent.slice(beforeGood);
assert.deepEqual(broadcast.map(item=>item.chat_id).sort(),[1,2,4]);
for(const reply of broadcast){assert.equal(reply.text,'Bot yangilandi');checkMenu(reply);}
assert.equal(records.get('botControls/appMenuBroadcast').delivered,3);
assert.equal(records.get('botControls/appMenuBroadcast').failed,1);
await handleUpdate(click(1));
const repeatBefore=sent.length;
await handleUpdate(message(1,'1234'));
assert.equal(sent.length-repeatBefore,3,'Refresh broadcasts again even without a code deployment');
await handleUpdate(click(2));
await handleUpdate(message(2,'bad'));
await handleUpdate(message(2,'bad'));
await handleUpdate(message(2,'bad'));
await handleUpdate(click(2));
assert.ok(sent.at(-1).text.includes('5 daqiqadan'));
await handleUpdate(click(4));
await handleUpdate(message(4,'/cancel'));
assert.equal(records.get('botRefreshSessions/4').awaitingCode,false);
await handleUpdate(message(1,'Test'));
assert.equal(records.get('profiles/1').state,'surname');
await handleUpdate(message(1,'User'));
await handleUpdate(message(1,'',{contact:{user_id:1,phone_number:'+998000000000'}}));
await handleUpdate(message(1,'',{location:{latitude:41,longitude:69}}));
checkMenu(sent.at(-1));
assert.equal(records.get('profiles/1').complete,true);
for(let id=5;id<=105;id++)records.set('profiles/'+id,{telegramUserId:id,complete:true});
await handleUpdate(click(1));
const paginationBefore=sent.length;
await handleUpdate(message(1,'1234'));
assert.equal(sent.length-paginationBefore,104,'All pages delivered except blocked user');
console.log('PASS: callback button, webhook callbacks, PIN, wrong-code lockout, repeated refresh, all old starters including incomplete profiles, pagination, blocked-chat isolation, cancellation, and registration flow.');

await rm(testDirectory, { recursive: true, force: true });
