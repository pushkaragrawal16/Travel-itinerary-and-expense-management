const btn = document.getElementById('hamburger');
const nav = document.getElementById('primaryNav');
if (btn && nav) {
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
}
const dz = document.getElementById('dz');
const fileMeta = document.getElementById('fileMeta');
if (dz && fileMeta) {
  const input = dz.querySelector('input[type="file"]');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('is-dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('is-dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('is-dragover'); input.files = e.dataTransfer.files; showMeta(); });
  input.addEventListener('change', showMeta);

  function showMeta(){
    if (!input.files || !input.files[0]) return fileMeta.textContent = '';
    const f = input.files[0];
    fileMeta.textContent = `${f.name} • ${(f.size/1024/1024).toFixed(2)} MB`;
  }
}
