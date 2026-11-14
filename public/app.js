const $ = (id)=>document.getElementById(id);
const state={user:null,tab:'home',authMode:'register',taskEdit:null,refreshBusy:false,lastMessageId:null,audioContext:null};
const monthNames=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const create=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
const empty=(text)=>create('div','empty',text);
function notify(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(notify.timeout);notify.timeout=setTimeout(()=>$('toast').hidden=true,3700);}
async function api(route,options={}){
 const headers=options.body instanceof FormData?{}:{'Content-Type':'application/json'};
 const res=await fetch('/api'+route,{credentials:'same-origin',...options,headers:{...headers,...options.headers}});
 let data;try{data=await res.json();}catch{throw Error('No se pudo conectar con el servidor.');}
 if(!res.ok)throw Error(data.error||'Ocurrió un error.');return data;
}
const send=(route,method,body)=>api(route,{method,body:JSON.stringify(body)});
function setAuthMode(mode){state.authMode=mode;$('tab-register').classList.toggle('active',mode==='register');$('tab-login').classList.toggle('active',mode==='login');$('birthday-field').hidden=mode==='login';$('auth-birthday').required=mode==='register';$('auth-submit').textContent=mode==='register'?'¡Entrar al salón! 🚀':'Entrar con mi PIN 💜';}
function setUser(user){state.user=user;$('auth').hidden=!!user;$('app').hidden=!user;$('account').hidden=!user;if(user){updatePushUI();$('welcome').textContent='¡Hola, '+user.name+'!';$('hero-name').textContent=user.name;$('my-birthday').value=user.birthday;openTab(state.tab);}}
async function handleAuth(e){e.preventDefault();const name=$('auth-name').value.trim(),pin=$('auth-pin').value,birthday=$('auth-birthday').value;try{const data=await send(state.authMode==='register'?'/register':'/login','POST',state.authMode==='register'?{name,pin,birthday}:{name,pin});$('auth-pin').value='';setUser(data.user);notify('¡Bienvenido/a, '+data.user.name+'! 🎉');}catch(err){notify(err.message);}}
async function logout(){try{if(pushSupported()){try{const r=await navigator.serviceWorker.ready;const sub=await r.pushManager.getSubscription();if(sub){await send('/push/unsubscribe','POST',{endpoint:sub.endpoint});await sub.unsubscribe();}}catch{}}await api('/logout',{method:'POST'});setUser(null);setAuthMode('login');notify('Sesión cerrada.');}catch(err){notify(err.message);}}
function openTab(name){state.tab=name;document.querySelectorAll('.pane').forEach(p=>p.hidden=p.id!==name);document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));if(state.user){if(name==='birthdays'||name==='home')loadBirthdays();if(name==='tasks'||name==='home')loadTasks();if(name==='chat'){loadMessages(true);updatePushUI();}}}
function birthdayCard(person){const card=create('div','birthday-card');card.append(create('span','emoji','🎂'));const detail=create('div');detail.append(create('strong','',person.name),create('small','',person.day+' de '+monthNames[person.month-1]));if(person.id===state.user.id)detail.append(create('small','',' · Tú 🎉'));card.append(detail);return card;}
async function loadBirthdays(){try{const {birthdays}=await api('/birthdays');const month=new Date().getMonth()+1;const thisMonth=birthdays.filter(b=>b.month===month);$('month-heading').textContent='🎊 Cumpleaños de '+monthNames[month-1];$('birthday-list').replaceChildren(...(thisMonth.length?thisMonth.map(birthdayCard):[empty('Todavía no hay cumpleaños este mes. ¡Invita a tus compañeros! 🎈')]));$('birthday-all').replaceChildren(...(birthdays.length?birthdays.map(birthdayCard):[empty('Aún no hay registros.') ]));$('home-birthdays').textContent=thisMonth.length+' cumpleaños este mes';}catch(err){if(state.tab==='birthdays')notify(err.message);}}
async function saveBirthday(){try{const {user}=await send('/me','PATCH',{birthday:$('my-birthday').value});setUser(user);notify('Tu cumpleaños se actualizó 🎂');}catch(err){notify(err.message);}}
function resetTask(){state.taskEdit=null;$('task-form').reset();$('task-form').hidden=true;}
function editTask(t){state.taskEdit=t.id;$('task-form-heading').textContent='Editar mi tarea';$('task-subject').value=t.subject;$('task-description').value=t.description;$('task-date').value=t.due_date;$('task-form').hidden=false;$('task-form').scrollIntoView({behavior:'smooth',block:'start'});}
async function removeTask(id){if(!confirm('¿Eliminar tu tarea?'))return;try{await api('/tasks/'+id,{method:'DELETE'});notify('Tarea eliminada.');loadTasks();}catch(err){notify(err.message);}}
async function submitTask(e){e.preventDefault();const body={subject:$('task-subject').value,description:$('task-description').value,due_date:$('task-date').value};try{await send(state.taskEdit?'/tasks/'+state.taskEdit:'/tasks',state.taskEdit?'PATCH':'POST',body);resetTask();notify('¡Tarea guardada! 📚');loadTasks();}catch(err){notify(err.message);}}
function taskCard(t){const card=create('article','task-card');card.append(create('h3','', '📓 '+t.subject));if(t.description)card.append(create('p','',t.description));card.append(create('div','meta','📅 Entrega: '+t.due_date+' · Publicada por '+t.author));if(t.author_id===state.user.id){const actions=create('div','actions');const edit=create('button','tiny','✏️ Editar');edit.addEventListener('click',()=>editTask(t));const del=create('button','tiny danger','🗑️ Eliminar');del.addEventListener('click',()=>removeTask(t.id));actions.append(edit,del);card.append(actions);}return card;}
async function loadTasks(){try{const {tasks}=await api('/tasks');$('task-list').replaceChildren(...(tasks.length?tasks.map(taskCard):[empty('Todavía no hay tareas. ¡Publica la primera! ✨')]));$('home-tasks').textContent=tasks.filter(t=>t.due_date>=new Date().toLocaleDateString('en-CA')).length+' tareas por entregar';}catch(err){if(state.tab==='tasks')notify(err.message);}}
async function removeMessage(id){if(!confirm('¿Eliminar tu mensaje?'))return;try{await api('/messages/'+id,{method:'DELETE'});loadMessages();}catch(err){notify(err.message);}}
async function editMessage(m){if(m.attachment_name){notify('Para cambiar un archivo, elimina el mensaje y vuelve a enviarlo.');return;}const edited=prompt('Editar tu mensaje:',m.body);if(edited===null)return;try{await send('/messages/'+m.id,'PATCH',{body:edited});loadMessages();}catch(err){notify(err.message);}}
function messageCard(m){const own=m.author_id===state.user.id;const box=create('article','message'+(own?' own':''));box.append(create('strong','',m.author));if(m.body)box.append(create('p','',m.body));
 if(m.attachment_name){
  const href='/api/attachments/'+m.id;
  if(m.attachment_mime?.startsWith('image/')){
   const link=create('a','attachment-image-link');link.href=href;link.target='_blank';link.rel='noopener noreferrer';
   const picture=create('img','attachment-image');picture.src=href;picture.alt='Foto adjunta: '+m.attachment_name;picture.loading='lazy';
   link.append(picture);box.append(link);
  }
  const link=create('a','attachment-download','📎 '+m.attachment_name+' · '+(m.attachment_size/1048576).toFixed(1)+' MB');
  link.href=href;link.target='_blank';link.rel='noopener noreferrer';box.append(link);
 }
 box.append(create('small','meta',m.created_at.replace('T',' ')+' UTC'+(m.updated_at!==m.created_at?' · editado':'')));if(own){const actions=create('div','actions');const edit=create('button','tiny','Editar');edit.addEventListener('click',()=>editMessage(m));if(m.attachment_name)edit.hidden=true;const del=create('button','tiny danger','Borrar');del.addEventListener('click',()=>removeMessage(m.id));actions.append(edit,del);box.append(actions);}return box;}
async function loadMessages(scroll=false){if(!state.user||state.refreshBusy)return;state.refreshBusy=true;try{const {messages}=await api('/messages');const root=$('chat-list');const atEnd=root.scrollTop+root.clientHeight>=root.scrollHeight-65;const previousLast=root.lastElementChild?.dataset?.id;const currentLast=messages.at(-1)?.id;const incoming=state.lastMessageId!==null && messages.some(m=>m.id>state.lastMessageId && m.author_id!==state.user.id);if(currentLast!==undefined)state.lastMessageId=Number(currentLast);if(incoming&&!document.hidden&&!scroll)playChatSound();const newContent=scroll||String(currentLast)!==previousLast||messages.length!==root.children.length||root.dataset.lastSnapshot!==JSON.stringify(messages.map(m=>[m.id,m.body,m.updated_at,m.attachment_name]));if(newContent){root.replaceChildren(...(messages.length?messages.map(messageCard):[empty('¡Inaugura el chat con un saludo! 👋')]));root.dataset.lastSnapshot=JSON.stringify(messages.map(m=>[m.id,m.body,m.updated_at,m.attachment_name]));if(scroll||atEnd)root.scrollTop=root.scrollHeight;}root.lastElementChild && (root.lastElementChild.dataset.id=String(currentLast));}catch(err){if(state.tab==='chat')notify(err.message);}finally{state.refreshBusy=false;}}
// Web Push requiere una acción explícita del usuario, HTTPS y un Service Worker.
function pushSupported(){return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;}
function updatePushUI(){
 const supported=pushSupported();
 $('push-enable').hidden=!supported || Notification.permission==='denied';
 $('push-status').textContent=!supported?'Este navegador no admite alertas push; en iPhone abre Mi Salón desde la pantalla de inicio.':
  Notification.permission==='denied'?'Notificaciones bloqueadas. Habilítalas desde Ajustes del dispositivo.':
  Notification.permission==='granted'?'Puedes activar avisos para este dispositivo.':'Toca Activar alertas para permitir notificaciones.';
 if(supported && Notification.permission==='granted'){
  navigator.serviceWorker.ready.then(r=>r.pushManager.getSubscription()).then(sub=>{
   if(!state.user)return;
   $('push-enable').hidden=!!sub;
   $('push-disable').hidden=!sub;
   if(sub)$('push-status').textContent='🔔 Alertas activadas en este dispositivo.';
  }).catch(()=>{});
 }
}
const applicationServerKey = key => {
 const base64=key.replace(/-/g,'+').replace(/_/g,'/');const padded=base64+'='.repeat((4-base64.length%4)%4);
 const raw=atob(padded);return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
async function enablePush(){
 if(!pushSupported()){notify('En iPhone debes agregar Mi Salón a la pantalla de inicio desde Safari.');return;}
 $('push-enable').disabled=true;
 try{
  // El permiso se solicita directamente como consecuencia de pulsar el botón.
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw Error('No se otorgó permiso para notificaciones.');
  const registration=await navigator.serviceWorker.register('/sw.js');
  const {publicKey}=await api('/push/public-key');
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationServerKey(publicKey)});
  await send('/push/subscribe','POST',{subscription:subscription.toJSON()});
  $('push-status').textContent='🔔 Alertas activadas en este dispositivo.';
  updatePushUI();notify('¡Recibirás alertas de tus compañeros! 🔔');
 }catch(err){notify(err.message || 'No se pudieron activar las alertas.');updatePushUI();}
 finally{$('push-enable').disabled=false;}
}
async function disablePush(){
 try{const r=await navigator.serviceWorker.ready;const subscription=await r.pushManager.getSubscription();
  if(subscription){await send('/push/unsubscribe','POST',{endpoint:subscription.endpoint});await subscription.unsubscribe();}
  $('push-disable').hidden=true;$('push-enable').hidden=false;
  $('push-status').textContent='Alertas desactivadas para este dispositivo.';notify('Alertas desactivadas.');
 }catch(err){notify(err.message);}
}
function playChatSound(){
 try{
  const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;
  const ctx=state.audioContext||(state.audioContext=new Ctx());if(ctx.state==='suspended')void ctx.resume();
  const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(720,ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(920,ctx.currentTime+.11);
  gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.08,ctx.currentTime+.02);
  gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.22);
  osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.23);
 }catch{}
}
function resetAttachedFile(){$('chat-file').value='';$('chat-file-name').textContent='Sin archivo seleccionado';$('chat-file-clear').hidden=true;}
$('chat-file').addEventListener('change',()=>{
 const file=$('chat-file').files[0];$('chat-file-name').textContent=file?file.name:'Sin archivo seleccionado';$('chat-file-clear').hidden=!file;
});
$('chat-file-clear').addEventListener('click',resetAttachedFile);
async function submitMessage(e){e.preventDefault();const body=$('chat-input').value.trim(),file=$('chat-file').files[0];if(!body&&!file){notify('Escribe un mensaje o anexa un archivo.');return;}
 if(file&&file.size>10*1024*1024){notify('El archivo supera el límite de 10 MB.');return;}
 const button=$('chat-form').querySelector('button[type=submit]');button.disabled=true;button.textContent='Enviando…';
 try{
  if(file){const form=new FormData();form.append('file',file);form.append('body',body);await api('/attachments',{method:'POST',headers:{},body:form});}
  else await send('/messages','POST',{body});
  $('chat-input').value='';resetAttachedFile();loadMessages(true);
 }catch(err){notify(err.message);}finally{button.disabled=false;button.textContent='Enviar ➤';}
}
$('tab-register').addEventListener('click',()=>setAuthMode('register'));
$('tab-login').addEventListener('click',()=>setAuthMode('login'));
$('auth-form').addEventListener('submit',handleAuth);
$('logout').addEventListener('click',logout);
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.go)));
$('save-birthday').addEventListener('click',saveBirthday);
$('add-task').addEventListener('click',()=>{state.taskEdit=null;$('task-form').reset();$('task-form-heading').textContent='Publicar tarea';$('task-form').hidden=false;});
$('cancel-task').addEventListener('click',resetTask);
$('task-form').addEventListener('submit',submitTask);
$('chat-form').addEventListener('submit',submitMessage);
$('push-enable').addEventListener('click',enablePush);
$('push-disable').addEventListener('click',disablePush);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
if(new URL(location.href).searchParams.has('chat'))state.tab='chat';
setInterval(()=>{if(state.user&&state.tab==='chat'&&!document.hidden)loadMessages();},3500);
api('/me').then(({user})=>setUser(user)).catch(()=>setUser(null));
