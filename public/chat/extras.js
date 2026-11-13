/* Lunaar Chat extras: emoji picker, owner controls and member tags. */
(() => {
  'use strict';
  const OWNER_EMAIL='jamessklar9@gmail.com';
  const EMOJIS=['😀','😃','😄','😁','😆','😅','😂','🤣','😊','🙂','😉','😍','🥰','😎','🤔','🙃','😭','💀','🔥','✨','🎉','❤️','💜','💙','💚','👍','👎','👏','🙏','💯','🚀','⭐','🌙','🎮','🫡','😴','🤯','🥳','👀','⚡','🐸','🍀','🌈'];
  let db=null, owner=false, tags=new Map(), panel=null, observer=null;
  const $=(s,r=document)=>r.querySelector(s);
  function emojiPicker(){
    const form=$('#composer'),input=$('#input'); if(!form||!input||$('.emoji-toggle'))return;
    const button=document.createElement('button');button.type='button';button.className='btn emoji-toggle';button.title='Insert emoji';button.setAttribute('aria-label','Insert emoji');button.textContent='😊';
    const picker=document.createElement('div');picker.className='emoji-picker';picker.hidden=true;
    EMOJIS.forEach(emoji=>{const b=document.createElement('button');b.type='button';b.textContent=emoji;b.title=emoji;b.onclick=()=>{const a=input.selectionStart??input.value.length,z=input.selectionEnd??input.value.length;input.setRangeText(emoji,a,z,'end');input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));picker.hidden=true;};picker.append(b);});
    button.onclick=()=>picker.hidden=!picker.hidden;document.addEventListener('click',e=>{if(!picker.contains(e.target)&&e.target!==button)picker.hidden=true;});
    form.insertBefore(button,form.querySelector('.send'));document.body.append(picker);
  }
  function paintTags(){
    document.querySelectorAll('#members .row,.msg-meta').forEach(row=>{
      const name=row.querySelector('.label,.author');if(!name)return;
      const old=row.querySelector('.chat-tag'),tag=tags.get(name.textContent.trim());
      if(!tag){old?.remove();return;} if(old){if(old.textContent!==tag) old.textContent=tag;return;}
      const badge=document.createElement('span');badge.className='chat-tag';badge.textContent=tag;name.after(badge);
    });
  }
  async function refreshTags(){
    if(!db)return;const {data,error}=await db.rpc('lunaar_get_tags');if(error||!Array.isArray(data))return;
    tags.clear();data.forEach(m=>{if(m.tag)tags.set(m.username,m.tag);});paintTags();
  }
  function closePanel(){panel?.remove();panel=null;}
  async function openPanel(){
    if(panel){closePanel();return;}
    panel=document.createElement('section');panel.className='owner-panel';
    panel.innerHTML='<button class="btn owner-close" type="button">Close</button><h2>👑 Lunaar owner controls</h2><p class="muted">Manage roles, member tags and bans. Permissions are verified by Supabase.</p><div class="owner-content">Loading…</div>';
    document.body.append(panel);$('.owner-close',panel).onclick=closePanel;await loadPanel();
  }
  async function loadPanel(){
    if(!panel)return;const box=$('.owner-content',panel);box.textContent='Loading…';
    const {data,error}=await db.rpc('lunaar_owner_list');
    if(error){box.textContent='Owner tools need the database migration. Run owner-tools.sql in Supabase SQL Editor. Details: '+error.message;return;}
    box.replaceChildren();if(!data?.length){box.textContent='No servers or members yet.';return;}
    data.forEach(server=>{
      const heading=document.createElement('h3');heading.textContent='🛡️ '+server.name;box.append(heading);
      (server.members||[]).forEach(m=>{
        const row=document.createElement('div');row.className='owner-row';
        const who=document.createElement('strong');who.textContent=m.username+' · '+(m.email||'');
        const role=document.createElement('select');['member','admin'].forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;o.selected=m.role===v;role.append(o);});
        role.onchange=async()=>{const r=await db.rpc('lunaar_owner_set_role',{p_server:m.server_id,p_user:m.user_id,p_role:role.value});if(r.error){alert(r.error.message);loadPanel();}};
        const tag=document.createElement('input');tag.maxLength=24;tag.placeholder='Tag (VIP, MOD…)';tag.value=m.tag||'';
        const save=document.createElement('button');save.className='btn';save.textContent='Save tag';save.onclick=async()=>{const r=await db.rpc('lunaar_owner_set_tag',{p_server:m.server_id,p_user:m.user_id,p_tag:tag.value.trim()||null});if(r.error)alert(r.error.message);else{await refreshTags();save.textContent='Saved ✓';}};
        const ban=document.createElement('button');ban.className='btn danger';ban.textContent='Ban';ban.onclick=async()=>{if(!confirm('Ban '+m.username+' from Lunaar Chat?'))return;const r=await db.rpc('lunaar_owner_ban',{p_user:m.user_id,p_reason:'Banned by chat owner'});if(r.error)alert(r.error.message);else await loadPanel();};
        row.append(who,role,tag,save,ban);box.append(row);
      });
    });
  }
  async function init(){
    if(!window.supabase?.createClient||!window.LUNAAR_CHAT?.SUPABASE_URL)return;
    db=window.supabase.createClient(window.LUNAAR_CHAT.SUPABASE_URL,window.LUNAAR_CHAT.SUPABASE_ANON_KEY);
    const {data}=await db.auth.getSession();const session=data.session;if(!session){emojiPicker();return;}
    owner=(session.user.email||'').toLowerCase()===OWNER_EMAIL;
    const {data:banned,error}=await db.rpc('lunaar_is_banned');
    if(!error&&banned===true){await db.auth.signOut();alert('This account is banned from Lunaar Chat.');return;}
    if(owner){const b=document.createElement('button');b.type='button';b.className='owner-tools';b.textContent='👑 Owner tools';b.onclick=openPanel;document.body.append(b);}
    await refreshTags();
    // Watch only chat content. Never observe document.body: adding a badge
    // would otherwise trigger this observer again and can lock up the UI.
    observer=new MutationObserver(()=>{
      if(observer._paintQueued)return;
      observer._paintQueued=true;
      queueMicrotask(()=>{observer._paintQueued=false;paintTags();});
    });
    const members=$('#members'),messages=$('#messages');
    if(members)observer.observe(members,{childList:true,subtree:true});
    if(messages)observer.observe(messages,{childList:true,subtree:true});
    emojiPicker();
    db.auth.onAuthStateChange((event,s)=>{if(event==='SIGNED_OUT'){document.querySelector('.owner-tools')?.remove();closePanel();observer?.disconnect();}else if(s&&(s.user.email||'').toLowerCase()===OWNER_EMAIL){owner=true;}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,200));else setTimeout(init,200);
})();
