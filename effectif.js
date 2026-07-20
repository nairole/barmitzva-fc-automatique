const header = document.querySelector('.nav-wrap');
const menu = document.querySelector('.menu');

menu.addEventListener('click', () => {
  const open = header.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', () => header.classList.remove('open')));
