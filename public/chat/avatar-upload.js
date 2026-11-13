/* Persistent profile-picture uploads to Supabase Storage. */
(() => {
  'use strict';
  const MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED = new Set(['image/jpeg','image/png','image/webp','image/gif']);
  const EXT = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
  let client = null;
  const $ = (s, root=document) => root.querySelector(s);

  function installUploader(modal) {
    if (!modal || modal.dataset.avatarUploadReady === '1') return;
    const urlInput = [...modal.querySelectorAll('input')].find(i => i.placeholder?.includes('https://'));
    if (!urlInput) return;
    modal.dataset.avatarUploadReady = '1';
    const label = urlInput.closest('label') || urlInput.parentElement;
    const wrap = document.createElement('div');
    wrap.className = 'avatar-upload-control';
    const title = document.createElement('div');
    title.className = 'avatar-upload-title';
    title.textContent = 'Or upload a profile picture';
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/gif';
    file.className = 'avatar-file-input';
    const status = document.createElement('small');
    status.className = 'avatar-upload-status';
    status.textContent = 'PNG, JPG, WEBP or GIF · up to 5 MB';
    const preview = document.createElement('img');
    preview.className = 'avatar-upload-preview'; preview.alt = 'Profile picture preview';
    preview.hidden = !urlInput.value;
    if (urlInput.value) preview.src = urlInput.value;
    wrap.append(title,file,status,preview);
    label.append(wrap);

    file.addEventListener('change', async () => {
      const image = file.files?.[0];
      if (!image) return;
      if (!ALLOWED.has(image.type)) { status.textContent = 'Choose a PNG, JPG, WEBP or GIF image.'; file.value=''; return; }
      if (image.size > MAX_BYTES) { status.textContent = 'That image is over 5 MB. Choose a smaller file.'; file.value=''; return; }
      file.disabled = true; status.textContent = 'Uploading…';
      try {
        const {data:{session},error:sessionError}=await client.auth.getSession();
        if (sessionError || !session?.user) throw new Error('Please sign in again before uploading.');
        const userId=session.user.id;
        const path=`${userId}/avatar.${EXT[image.type]}`;
        const {error}=await client.storage.from('avatars').upload(path,image,{upsert:true,contentType:image.type,cacheControl:'3600'});
        if(error) throw error;
        const {data}=client.storage.from('avatars').getPublicUrl(path);
        const url=`${data.publicUrl}?v=${Date.now()}`;
        urlInput.value=url;
        preview.src=url; preview.hidden=false;
        status.textContent='Uploaded ✓ Now press Save to apply it to your profile.';
      } catch(err) {
        status.textContent=`Upload failed: ${err.message || err}`;
      } finally { file.disabled=false; }
    });
  }

  function watchModals() {
    const root=$('#modal-root');
    if(!root) return;
    const scan=()=>root.querySelectorAll('.modal').forEach(installUploader);
    new MutationObserver(scan).observe(root,{childList:true,subtree:true});
    scan();
  }
  function start() {
    if(!window.supabase?.createClient || !window.LUNAAR_CHAT?.SUPABASE_URL) return;
    client=window.supabase.createClient(window.LUNAAR_CHAT.SUPABASE_URL,window.LUNAAR_CHAT.SUPABASE_ANON_KEY);
    watchModals();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();
