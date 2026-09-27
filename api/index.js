const crypto = require('crypto');
const admin = require('firebase-admin');
const {OAuth2Client} = require('google-auth-library');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_SCRIPT_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID || undefined);
let firebaseReady = false;
const FLW_SANDBOX = 'https://developersandbox-api.flutterwave.com';
const FLW_PRODUCTION = 'https://f4bexperience.flutterwave.com';
const PLANS = [
  {id:'pro_monthly', name:'Pro Monthly', amount:5, currency:'USD', interval:'monthly', days:30},
  {id:'pro_yearly', name:'Pro Yearly', amount:49, currency:'USD', interval:'yearly', days:365},
  {id:'pro_ngn_monthly', name:'Pro Monthly', amount:7500, currency:'NGN', interval:'monthly', days:30},
  {id:'pro_ngn_yearly', name:'Pro Yearly', amount:75000, currency:'NGN', interval:'yearly', days:365}
];

function send(res,status,data){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(data));}
function parseBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6){reject(Object.assign(new Error('Request too large'),{status:413}));req.destroy();}});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(Object.assign(new Error('Invalid JSON'),{status:400}))}});req.on('error',reject)})}
function db(){
  if(firebaseReady)return admin.firestore();
  if(!process.env.FIREBASE_SERVICE_ACCOUNT)return null;
  try{const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);admin.initializeApp({credential:admin.credential.cert(sa)});firebaseReady=true;return admin.firestore();}
  catch(e){throw Object.assign(new Error('Billing database configuration is invalid.'),{status:500});}
}
function docId(email){return crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex');}
async function user(email){const d=db();if(!d)return null;const s=await d.collection('users').doc(docId(email)).get();return s.exists?s.data():null;}
async function saveUser(email,data){const d=db();if(!d)throw Object.assign(new Error('Billing database is not configured.'),{status:503});await d.collection('users').doc(docId(email)).set(Object.assign({email:String(email).toLowerCase()},data),{merge:true});}
function plan(id){return PLANS.find(x=>x.id===id);}
function randomToken(){return crypto.randomBytes(32).toString('base64url');}
function hashToken(t){return crypto.createHash('sha256').update(String(t)).digest('hex');}
function now(){return Date.now();}
function addPeriod(ts,p){const d=new Date(ts);if(p.interval==='monthly')d.setMonth(d.getMonth()+1);else d.setFullYear(d.getFullYear()+1);return d.getTime();}
function normalizeName(name,email){if(name)return String(name).slice(0,120);return String(email).split('@')[0].slice(0,120);}

async function verifyGoogle(req){
  if(!GOOGLE_CLIENT_ID)throw Object.assign(new Error('Google OAuth client is not configured.'),{status:503});
  const auth=String(req.headers.authorization||'');
  if(!auth.startsWith('Bearer '))throw Object.assign(new Error('Google authorization required. Re-open FlipSheet and try again.'),{status:401});
  const token=auth.slice(7);
  const ticket=await googleClient.verifyIdToken({idToken:token,audience:GOOGLE_CLIENT_ID||undefined});
  const p=ticket.getPayload();
  if(!p||!p.sub||!p.email)throw Object.assign(new Error('Invalid Google identity.'),{status:401});
  if(GOOGLE_CLIENT_ID&&p.aud!==GOOGLE_CLIENT_ID)throw Object.assign(new Error('Invalid Google audience.'),{status:401});
  return {sub:p.sub,email:p.email.toLowerCase(),name:p.name||''};
}

async function flwToken(){
  const base=process.env.FLW_ENV==='production'?FLW_PRODUCTION:FLW_SANDBOX;
  if(!process.env.FLW_CLIENT_ID||!process.env.FLW_CLIENT_SECRET)throw Object.assign(new Error('Flutterwave v4 credentials are not configured.'),{status:503});
  const r=await fetch('https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.FLW_CLIENT_ID,client_secret:process.env.FLW_CLIENT_SECRET,grant_type:'client_credentials'})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.access_token)throw Object.assign(new Error('Flutterwave v4 authentication failed.'),{status:502,data:j});
  return {token:j.access_token,base};
}
async function flwV4(path,opts={}){
  const {token,base}=await flwToken();
  const headers=Object.assign({'Authorization':'Bearer '+token,'Content-Type':'application/json','accept':'application/json','X-Trace-Id':crypto.randomUUID(),'X-Idempotency-Key':opts.idempotencyKey||crypto.randomUUID()},opts.headers||{});
  const r=await fetch(base+path,Object.assign({},opts,{headers}));
  const text=await r.text();let j={};try{j=JSON.parse(text)}catch{j={raw:text}};
  if(!r.ok)throw Object.assign(new Error(j?.error?.message||j?.message||'Flutterwave request failed.'),{status:r.status,data:j});
  return j;
}

async function checkoutSession(req,res){
  const ident=await verifyGoogle(req);const b=await parseBody(req);const p=plan(b.plan||'pro_monthly');
  if(!p)return send(res,400,{error:'Unknown plan.'});
  const token=randomToken();const d=db();if(!d)return send(res,503,{error:'Billing is not configured yet.'});
  await d.collection('checkoutSessions').doc(hashToken(token)).set({email:ident.email,googleSub:ident.sub,planId:p.id,createdAt:now(),expiresAt:now()+15*60*1000,status:'open'});
  const app=process.env.APP_URL||'';
  send(res,200,{ok:true,checkoutUrl:app+'/billing/checkout?token='+encodeURIComponent(token),plan:{id:p.id,name:p.name,amount:p.amount,currency:p.currency,interval:p.interval}});
}
async function getSession(token){
  if(!token||token.length<20)throw Object.assign(new Error('Checkout session is invalid or expired.'),{status:401});
  const d=db();if(!d)throw Object.assign(new Error('Billing is not configured.'),{status:503});
  const s=await d.collection('checkoutSessions').doc(hashToken(token)).get();
  if(!s.exists)throw Object.assign(new Error('Checkout session is invalid or expired.'),{status:401});
  const x=s.data();if(x.status!=='open'||x.expiresAt<now())throw Object.assign(new Error('Checkout session has expired. Start checkout again from FlipSheet.'),{status:410});
  const p=plan(x.planId);if(!p)throw Object.assign(new Error('Selected plan is unavailable.'),{status:400});
  return {token,email:x.email,googleSub:x.googleSub,plan:p};
}

async function billingConfig(req,res){
  const token=String(req.query?.token||'');
  try{const s=await getSession(token);send(res,200,{ok:true,plan:s.plan,flutterwave:{encryptionKey:process.env.FLW_ENCRYPTION_KEY||''},appUrl:process.env.APP_URL||''});}
  catch(e){send(res,e.status||500,{error:e.message});}
}

async function createCustomer(email,name){
  const existing=await user(email);if(existing?.flwCustomerId)return existing.flwCustomerId;
  const j=await flwV4('/customers',{method:'POST',body:JSON.stringify({email,name:{first:normalizeName(name,email)},meta:{sheetops_email:email}})});
  const id=j?.data?.id;if(!id)throw new Error('Flutterwave did not return a customer ID.');
  await saveUser(email,{flwCustomerId:id,updatedAt:now()});return id;
}
function cardPayload(body){
  const required=['nonce','encrypted_card_number','encrypted_expiry_month','encrypted_expiry_year','encrypted_cvv'];
  for(const k of required)if(!body[k]||typeof body[k]!=='string')throw Object.assign(new Error('Secure card details are incomplete.'),{status:400});
  if(body.nonce.length!==12)throw Object.assign(new Error('Secure card session is invalid. Please try again.'),{status:400});
  return {type:'card',card:{nonce:body.nonce,encrypted_card_number:body.encrypted_card_number,encrypted_expiry_month:body.encrypted_expiry_month,encrypted_expiry_year:body.encrypted_expiry_year,encrypted_cvv:body.encrypted_cvv}};
}

async function initialCharge(req,res){
  const b=await parseBody(req);let s;
  try{s=await getSession(String(b.token||''));}catch(e){return send(res,e.status||500,{error:e.message});}
  const {plan:p,email}=s;
  if(!process.env.FLW_ENCRYPTION_KEY)return send(res,503,{error:'Flutterwave encryption key is not configured.'});
  const reference='SHEETOPS-'+crypto.randomUUID().replace(/-/g,'').slice(0,26);
  try{
    const customerId=await createCustomer(email,b.name);
    const pm=await flwV4('/payment-methods',{method:'POST',body:JSON.stringify(cardPayload(b))});
    const paymentMethodId=pm?.data?.id;if(!paymentMethodId)throw new Error('Flutterwave did not return a payment method ID.');
    const charge=await flwV4('/charges',{method:'POST',idempotencyKey:reference,body:JSON.stringify({amount:p.amount,currency:p.currency,reference,customer_id:customerId,payment_method_id:paymentMethodId,redirect_url:(process.env.APP_URL||'')+'/billing/success?token='+encodeURIComponent(s.token),meta:{sheetops_email:email,sheetops_plan:p.id},recurring:false})});
    const d=charge?.data||{};
    await saveUser(email,{googleSub:s.googleSub,flwCustomerId:customerId,flwPaymentMethodId:paymentMethodId,pendingChargeId:d.id||null,pendingReference:reference,requestedPlan:p.id,status:'pending',updatedAt:now()});
    const status=String(d.status||'').toLowerCase();
    if(status==='succeeded'){
      await activateAfterVerified(email,p,d,customerId,paymentMethodId,reference);
      await closeSession(s.token);
      return send(res,200,{ok:true,status:'succeeded',message:'Payment confirmed. Pro is active.',redirect:'/billing/success?token='+encodeURIComponent(s.token)});
    }
    const next=d.next_action||{};
    if(next.type==='redirect_url'&&next.redirect_url?.url)return send(res,200,{ok:true,status:'redirect',redirectUrl:next.redirect_url.url,chargeId:d.id});
    if(next.type==='authorize'&&next.authorization?.type==='otp')return send(res,200,{ok:true,status:'otp',chargeId:d.id,message:'Enter the one-time code sent by your bank.'});
    if(next.type==='authorize'&&next.authorization?.type==='pin')return send(res,200,{ok:true,status:'pin',chargeId:d.id,message:'Your bank requires PIN authorization. Continue through the secure Flutterwave authorization screen if provided.',redirectUrl:next.authorization?.redirect_url?.url||null});
    return send(res,200,{ok:true,status:status||'pending',chargeId:d.id,message:'Payment is being processed. This page will update automatically.'});
  }catch(e){
    const msg=e?.data?.error?.message||e.message||'Payment could not be started.';
    return send(res,e.status>=400&&e.status<500?e.status:502,{error:msg});
  }
}

async function authorizeCharge(req,res){
  const b=await parseBody(req);let s;try{s=await getSession(String(b.token||''));}catch(e){return send(res,e.status||500,{error:e.message});}
  if(!b.chargeId)return send(res,400,{error:'Charge ID is required.'});
  if(!/^chg_[A-Za-z0-9]+$/.test(String(b.chargeId)))return send(res,400,{error:'Invalid charge ID.'});
  if(!/^\d{4,8}$/.test(String(b.otp||'')))return send(res,400,{error:'Enter the one-time code from your bank.'});
  try{
    const j=await flwV4('/charges/'+encodeURIComponent(b.chargeId),{method:'PUT',body:JSON.stringify({authorization:{type:'otp',otp:{code:String(b.otp)}}})});
    const d=j?.data||{};const st=String(d.status||'').toLowerCase();
    if(st==='succeeded'){
      await activateAfterVerified(s.email,s.plan,d,null,null,d.reference||null);await closeSession(s.token);
      return send(res,200,{ok:true,status:'succeeded',message:'Payment confirmed. Pro is active.'});
    }
    if(d.next_action?.type==='redirect_url'&&d.next_action.redirect_url?.url)return send(res,200,{ok:true,status:'redirect',redirectUrl:d.next_action.redirect_url.url,chargeId:d.id});
    return send(res,200,{ok:true,status:st||'pending',message:'Authorization is still processing.'});
  }catch(e){return send(res,e.status>=400&&e.status<500?e.status:502,{error:e?.data?.error?.message||e.message||'Authorization failed.'});}
}

async function verifyV4Charge(id){return flwV4('/charges/'+encodeURIComponent(id),{method:'GET'});}
async function activateAfterVerified(email,p,d,customerId,paymentMethodId,reference){
  const status=String(d.status||'').toLowerCase();if(status!=='succeeded')throw new Error('Payment is not successful.');
  const paidAmount=Number(d.amount||0),paidCurrency=String(d.currency||'').toUpperCase();
  if(paidAmount!==Number(p.amount)||paidCurrency!==p.currency)throw new Error('Payment amount or currency does not match the selected plan.');
  const existing=await user(email);const paymentId=String(d.id||'');if(existing?.lastPaymentId&&paymentId&&existing.lastPaymentId===paymentId)return;const cid=customerId||existing?.flwCustomerId;const pmid=paymentMethodId||existing?.flwPaymentMethodId;const base=existing?.status==='active'&&Number(existing?.expiresAt||0)>now()?Number(existing.expiresAt):now();
  await saveUser(email,{status:'active',plan:'pro',planId:p.id,expiresAt:addPeriod(base,p),nextChargeAt:addPeriod(base,p),flwCustomerId:cid||null,flwPaymentMethodId:pmid||null,lastPaymentId:String(d.id||''),lastPaymentRef:d.reference||reference||null,lastPaymentAt:now(),updatedAt:now()});
}
async function closeSession(token){const d=db();if(d)await d.collection('checkoutSessions').doc(hashToken(token)).set({status:'completed',completedAt:now()},{merge:true});}

async function license(req,res){const ident=await verifyGoogle(req);const u=await user(ident.email);const active=!!u&&u.status==='active'&&(!u.expiresAt||u.expiresAt>now());send(res,200,{plan:active?'pro':'free',active,expiresAt:u?.expiresAt||null,planId:u?.planId||null,status:u?.status||'free',cancelAtPeriodEnd:!!u?.cancelAtPeriodEnd});}
async function billingStatus(req,res){try{const s=await getSession(String(req.query?.token||''));const u=await user(s.email);const active=!!u&&u.status==='active'&&(!u.expiresAt||u.expiresAt>now());send(res,200,{ok:true,active,status:u?.status||'pending',planId:u?.planId||s.plan.id,expiresAt:u?.expiresAt||null,cancelAtPeriodEnd:!!u?.cancelAtPeriodEnd});}catch(e){send(res,e.status||500,{error:e.message});}}
async function cancelBilling(req,res){const ident=await verifyGoogle(req);const u=await user(ident.email);if(!u||u.status!=='active')return send(res,400,{error:'No active Pro renewal was found.'});await saveUser(ident.email,{cancelAtPeriodEnd:true,nextChargeAt:null,updatedAt:now()});send(res,200,{ok:true,message:'Future recurring charges are stopped. Your current Pro access remains until '+new Date(u.expiresAt||now()).toLocaleDateString()+'.'});}

function safeEqual_(a,b){const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function webhookValid(req,raw){
  const secret=process.env.FLW_SECRET_HASH;if(!secret)return false;
  const sig=String(req.headers['flutterwave-signature']||'');
  if(sig){const digest=crypto.createHmac('sha256',secret).update(raw).digest('base64');return safeEqual_(digest,sig);}
  return false;
}
async function webhook(req,res){
  const raw=req.rawBody||await new Promise((resolve,reject)=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>resolve(s));req.on('error',reject)});
  if(!webhookValid(req,raw))return send(res,401,{error:'Invalid webhook signature.'});
  let p;try{p=JSON.parse(raw)}catch{return send(res,400,{error:'Invalid JSON.'})}
  let eventRef=null;
  try{
    const event=String(p.type||p.event||'');const tx=p.data||{};const email=String(tx.customer?.email||tx.meta?.sheetops_email||'').toLowerCase();
    if(!email)return send(res,200,{ok:true});
    const dbase=db();const eventKey=String(p.id||p.webhook_id||tx.id||tx.reference||crypto.createHash('sha256').update(raw).digest('hex'));
    if(dbase){eventRef=dbase.collection('webhookEvents').doc(hashToken(eventKey));const snap=await eventRef.get();if(snap.exists)return send(res,200,{ok:true,duplicate:true});await eventRef.create({eventKey,event,status:'processing',receivedAt:now()});}
    const chargeId=String(tx.id||'');let verified=p;
    if(chargeId.startsWith('chg_'))verified=await verifyV4Charge(chargeId);
    const d=verified.data||tx;const status=String(d.status||'').toLowerCase();const u=await user(email);const chosen=plan(d.meta?.sheetops_plan)||plan(tx.meta?.sheetops_plan)||plan(u?.planId);
    if(status==='succeeded'&&chosen){
      await activateAfterVerified(email,chosen,d,u?.flwCustomerId,d.payment_method_details?.id||u?.flwPaymentMethodId,d.reference||null);
    }else if((event.includes('failed')||status==='failed')&&u){await saveUser(email,{status:'past_due',updatedAt:now()});}
    if(eventRef)await eventRef.set({status:'processed',processedAt:now()},{merge:true});
    return send(res,200,{ok:true});
  }catch(e){if(eventRef)try{await eventRef.delete()}catch(_){};console.error(e);return send(res,500,{error:'Webhook processing failed.'});}
}

async function renewals(req,res){
  const secret=String(process.env.CRON_SECRET||'');if(!secret||req.headers.authorization!=='Bearer '+secret)return send(res,401,{error:'Unauthorized.'});
  const d=db();if(!d)return send(res,503,{error:'Billing database is not configured.'});
  const snap=await d.collection('users').where('status','==','active').where('nextChargeAt','<=',now()).limit(25).get();
  let attempted=0,succeeded=0,failed=0;
  for(const doc of snap.docs){
    const u=doc.data();const p=plan(u.planId);if(!p||!u.flwCustomerId||!u.flwPaymentMethodId||u.cancelAtPeriodEnd)continue;if(u.renewalLockAt&&u.renewalLockAt>now()-5*60*1000)continue;attempted++;await doc.ref.set({renewalLockAt:now()},{merge:true});
    try{
      const reference='SHEETOPS-REN-'+crypto.randomUUID().replace(/-/g,'').slice(0,22);
      const j=await flwV4('/charges',{method:'POST',idempotencyKey:reference,body:JSON.stringify({amount:p.amount,currency:p.currency,reference,customer_id:u.flwCustomerId,payment_method_id:u.flwPaymentMethodId,recurring:true,meta:{sheetops_email:u.email,sheetops_plan:p.id,renewal:true}})});
      const ch=j?.data||{};
      if(String(ch.status).toLowerCase()==='succeeded'){
        await activateAfterVerified(u.email,p,ch,u.flwCustomerId,u.flwPaymentMethodId,reference);await doc.ref.set({renewalLockAt:null},{merge:true});succeeded++;
      }else{
        await doc.ref.set({status:'past_due',renewalAttemptAt:now(),renewalLockAt:null,lastRenewalStatus:ch.status||'pending',lastRenewalChargeId:ch.id||null,updatedAt:now()},{merge:true});failed++;
      }
    }catch(e){await doc.ref.set({status:'past_due',renewalAttemptAt:now(),renewalLockAt:null,lastRenewalError:String(e.message||e).slice(0,300),updatedAt:now()},{merge:true});failed++;}
  }
  send(res,200,{ok:true,attempted,succeeded,failed});
}

async function pushUnregister(req,res){const ident=await verifyFirebase(req);const b=await parseBody(req);const token=String(b.token||'');if(!token)return send(res,400,{error:'Notification token required.'});const d=db();if(!d)return send(res,503,{error:'Notifications are not configured.'});const key=crypto.createHash('sha256').update(token).digest('hex');await d.collection('users').doc(docId(ident.email)).collection('devices').doc(key).delete();send(res,200,{ok:true});}
async function pushRegister(req,res){const ident=await verifyFirebase(req);const b=await parseBody(req);const token=String(b.token||'');if(!token)return send(res,400,{error:'Notification token required.'});const d=db();if(!d)return send(res,503,{error:'Notifications are not configured.'});const key=crypto.createHash('sha256').update(token).digest('hex');await d.collection('users').doc(docId(ident.email)).collection('devices').doc(key).set({token,updatedAt:now(),userAgent:String(b.userAgent||'').slice(0,300)},{merge:true});send(res,200,{ok:true});}
async function verifyFirebase(req){const auth=String(req.headers.authorization||'');if(!auth.startsWith('Bearer '))throw Object.assign(new Error('Sign-in required.'),{status:401});const d=db();if(!d)throw Object.assign(new Error('Firebase is not configured.'),{status:503});const decoded=await admin.auth().verifyIdToken(auth.slice(7));if(!decoded.email)throw Object.assign(new Error('Verified email required.'),{status:401});return {email:decoded.email.toLowerCase()};}
async function pushSend(req,res){const ident=await verifyGoogle(req);const b=await parseBody(req);const d=db();if(!d)return send(res,503,{error:'Notifications are not configured.'});const snap=await d.collection('users').doc(docId(ident.email)).collection('devices').get();const docs=snap.docs.filter(x=>x.data().token);const tokens=docs.map(x=>x.data().token);if(!tokens.length)return send(res,200,{sent:0,failed:0});const r=await admin.messaging().sendEachForMulticast({tokens,notification:{title:String(b.title||'FlipSheet').slice(0,100),body:String(b.body||'Your FlipSheet automation finished.').slice(0,300)},data:{url:String(b.url||process.env.APP_URL||'/')}});const stale=[];r.responses.forEach((item,i)=>{if(!item.success){const code=String(item.error?.code||'');if(code.includes('registration-token-not-registered')||code.includes('invalid-registration-token'))stale.push(docs[i].ref);}});if(stale.length)await Promise.all(stale.map(ref=>ref.delete().catch(()=>{})));send(res,200,{sent:r.successCount,failed:r.failureCount,removedStale:stale.length});}
async function plans(req,res){send(res,200,{plans:PLANS.map(p=>({id:p.id,name:p.name,amount:p.amount,currency:p.currency,interval:p.interval,days:p.days}))});}
const DEFAULT_FIREBASE_VAPID_KEY='BPWw-RCoWvATaIbiCb2PiZBmCNuIzopcXcdYGu2ybXntLv8NL8nWs5uVJhDwCe8w97new2pyPztJx5tIZyjh1Do';
async function config(req,res){const vapidKey=process.env.FIREBASE_VAPID_KEY||DEFAULT_FIREBASE_VAPID_KEY;send(res,200,{appUrl:process.env.APP_URL||'',firebase:process.env.FIREBASE_WEB_CONFIG?JSON.parse(process.env.FIREBASE_WEB_CONFIG):null,vapidKey,notificationsEnabled:!!(process.env.FIREBASE_WEB_CONFIG&&vapidKey)});}

module.exports=async function(req,res){
  try{
    const u=new URL(req.url,'http://localhost');const path=u.pathname.replace(/^\/api/,'')||'/';req.query=Object.fromEntries(u.searchParams);
    if(req.method==='OPTIONS'){res.statusCode=204;res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');return res.end();}
    if(path==='/plans'&&req.method==='GET')return plans(req,res);
    if(path==='/config'&&req.method==='GET')return config(req,res);
    if(path==='/license'&&req.method==='GET')return license(req,res);
    if(path==='/checkout/session'&&req.method==='POST')return checkoutSession(req,res);
    if(path==='/billing/config'&&req.method==='GET')return billingConfig(req,res);
    if(path==='/billing/charge'&&req.method==='POST')return initialCharge(req,res);
    if(path==='/billing/authorize'&&req.method==='POST')return authorizeCharge(req,res);
    if(path==='/billing/status'&&req.method==='GET')return billingStatus(req,res);
    if(path==='/billing/cancel'&&req.method==='POST')return cancelBilling(req,res);
    if(path==='/billing/renew'&&req.method==='GET')return renewals(req,res);
    if(path==='/flutterwave/webhook'&&req.method==='POST')return webhook(req,res);
    if(path==='/push/register'&&req.method==='POST')return pushRegister(req,res);
    if(path==='/push/unregister'&&req.method==='POST')return pushUnregister(req,res);
    if(path==='/push/send'&&req.method==='POST')return pushSend(req,res);
    return send(res,404,{error:'Not found.'});
  }catch(e){console.error(e);send(res,e.status||500,{error:e.message||'Server error.'});}
};
module.exports.config={api:{bodyParser:false}};
