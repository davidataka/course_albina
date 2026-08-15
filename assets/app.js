(() => {
  'use strict';

  const data = window.COURSE_DATA;
  const content = document.querySelector('#content');
  const nav = document.querySelector('#courseNav');
  const searchInput = document.querySelector('#searchInput');
  const sidebar = document.querySelector('#sidebar');
  const scrim = document.querySelector('#scrim');
  const menuButton = document.querySelector('#menuButton');
  const lightbox = document.querySelector('#lightbox');
  const lightboxImage = document.querySelector('#lightboxImage');
  const lightboxCaption = document.querySelector('#lightboxCaption');
  const lessons = data.sections.flatMap(section => section.lessons.map(lesson => ({ ...lesson, section })));
  const byId = new Map(lessons.map(lesson => [lesson.id, lesson]));
  const progressKey = 'course-albina-completed-v1';
  const localHost = ['localhost', '127.0.0.1'].includes(location.hostname);
  let completed = new Set(readProgress());

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function readProgress() {
    try { return JSON.parse(localStorage.getItem(progressKey) || '[]'); }
    catch { return []; }
  }

  function saveProgress() {
    localStorage.setItem(progressKey, JSON.stringify([...completed]));
    updateProgress();
  }

  function updateProgress() {
    const count = completed.size;
    const percent = Math.round((count / lessons.length) * 100);
    document.querySelector('#progressLabel').textContent = `${count} из ${lessons.length} уроков`;
    document.querySelector('#progressPercent').textContent = `${percent}%`;
    document.querySelector('#progressBar').style.width = `${percent}%`;
    nav.querySelectorAll('.nav-lesson').forEach(button => button.classList.toggle('done', completed.has(button.dataset.id)));
  }

  function mediaSummary(lesson) {
    const images = lesson.blocks.filter(block => block.type === 'image').length;
    const videos = lesson.blocks.filter(block => block.type === 'video').length;
    return [videos ? `${videos} видео` : '', images ? `${images} изображ.` : ''].filter(Boolean);
  }

  function renderNav(query = '') {
    const normalized = query.trim().toLocaleLowerCase('ru');
    nav.replaceChildren();
    let resultCount = 0;

    data.sections.forEach((section, sectionIndex) => {
      const visible = section.lessons.filter(lesson => {
        const haystack = `${lesson.title} ${lesson.description || ''} ${lesson.breadcrumb.join(' ')}`.toLocaleLowerCase('ru');
        return !normalized || haystack.includes(normalized);
      });
      if (!visible.length) return;
      resultCount += visible.length;

      const wrapper = el('section', 'nav-section');
      const title = el('div', 'nav-section-title');
      title.append(el('span', '', section.title), el('span', '', String(visible.length)));
      wrapper.append(title);
      const list = el('div', 'nav-lessons');

      visible.forEach(lesson => {
        const button = el('button', 'nav-lesson', lesson.title);
        button.type = 'button';
        button.dataset.id = lesson.id;
        button.dataset.number = String(lesson.index).padStart(2, '0');
        button.classList.toggle('done', completed.has(lesson.id));
        button.addEventListener('click', () => {
          location.hash = lesson.id;
          closeMenu();
        });
        list.append(button);
      });
      wrapper.append(list);
      nav.append(wrapper);
    });

    if (!resultCount) nav.append(el('p', 'nav-empty', 'Ничего не найдено. Попробуйте другой запрос.'));
    highlightActive();
  }

  function highlightActive() {
    const id = location.hash.slice(1);
    nav.querySelectorAll('.nav-lesson').forEach(button => button.classList.toggle('active', button.dataset.id === id));
    const active = nav.querySelector('.nav-lesson.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function renderOverview() {
    document.title = `${data.title} — архив курса`;
    const page = el('div', 'page overview');
    const hero = el('section', 'hero');
    const heroCopy = el('div', 'hero-copy');
    heroCopy.append(el('span', 'eyebrow', 'Сохранённая версия'));
    heroCopy.append(el('h1', '', data.title));
    heroCopy.append(el('p', '', 'Материалы курса собраны в исходной последовательности: уроки, видео, субтитры и изображения доступны в одном спокойном пространстве.'));
    hero.append(heroCopy);
    page.append(hero);

    const stats = el('section', 'stats', '');
    [
      [data.stats.lessons, 'уроков'],
      [data.stats.videos, 'видео'],
      [data.stats.duration, 'общая длительность'],
      [data.stats.images, 'изображений']
    ].forEach(([value, label]) => {
      const card = el('div', 'stat');
      card.append(el('strong', '', String(value)), el('span', '', label));
      stats.append(card);
    });
    page.append(stats);

    const heading = el('div', 'section-heading');
    heading.append(el('h2', '', 'Разделы курса'), el('p', '', 'Выберите раздел, чтобы продолжить'));
    page.append(heading);
    const grid = el('section', 'section-grid');
    data.sections.forEach((section, index) => {
      const button = el('button', 'section-card');
      button.type = 'button';
      button.append(el('span', 'section-index', String(index + 1).padStart(2, '0')));
      button.append(el('strong', '', section.title));
      button.append(el('small', '', `${section.lessons.length} ${pluralLessons(section.lessons.length)}`));
      button.addEventListener('click', () => { location.hash = section.lessons[0].id; });
      grid.append(button);
    });
    page.append(grid);

    page.append(el('aside', 'archive-note', 'Это личная архивная копия для самостоятельного изучения. Сайт не связан с исходной школой, не собирает персональные данные и хранит отметки о прохождении только в вашем браузере.'));
    content.replaceChildren(page);
    highlightActive();
  }

  function pluralLessons(number) {
    const mod10 = number % 10;
    const mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return 'урок';
    if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return 'урока';
    return 'уроков';
  }

  function renderLesson(lesson) {
    document.title = `${lesson.title} — ${data.title}`;
    const page = el('article', 'page lesson-page');
    const crumbs = el('div', 'breadcrumbs');
    lesson.breadcrumb.forEach(item => crumbs.append(el('span', '', item)));
    page.append(crumbs);

    const header = el('header', 'lesson-header');
    header.append(el('span', 'eyebrow', `Урок ${String(lesson.index).padStart(2, '0')}`));
    header.append(el('h1', '', lesson.title));
    if (lesson.description) header.append(el('p', 'lesson-description', lesson.description));
    const chips = el('div', 'lesson-meta');
    mediaSummary(lesson).forEach(item => chips.append(el('span', 'meta-chip', item)));
    if (chips.childElementCount) header.append(chips);
    page.append(header);

    const lessonContent = el('section', 'lesson-content');
    lesson.blocks.forEach(block => lessonContent.append(renderBlock(block, lesson)));
    if (!lesson.blocks.length) lessonContent.append(el('p', 'lesson-text', 'В этом уроке нет отдельных материалов.'));
    page.append(lessonContent);
    page.append(renderPager(lesson));
    content.replaceChildren(page);
    highlightActive();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderBlock(block, lesson) {
    if (block.type === 'image') {
      const button = el('button', 'lesson-image');
      button.type = 'button';
      const image = new Image();
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = encodeURI(block.src);
      image.alt = block.alt || `${lesson.title} — изображение ${block.number}`;
      button.append(image);
      button.addEventListener('click', () => openLightbox(image.src, image.alt));
      return button;
    }

    if (block.type === 'video') {
      const card = el('figure', 'video-card');
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = localHost ? encodeURI(block.localSrc) : block.src;
      if (block.caption) {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = 'Русские субтитры';
        track.srclang = 'ru';
        track.src = encodeURI(block.caption);
        video.append(track);
      }
      const caption = el('figcaption', 'video-caption');
      caption.append(el('span', '', `Видео ${String(block.number).padStart(2, '0')}`));
      const download = el('a', '', 'Открыть отдельно');
      download.href = video.src;
      download.target = '_blank';
      download.rel = 'noopener';
      caption.append(download);
      card.append(video, caption);
      return card;
    }

    if (block.style === 'heading') return el('h2', 'lesson-text heading', block.text);
    if (block.style === 'list') {
      const list = el('ul', 'lesson-list');
      block.text.split(/\n+/).map(line => line.replace(/^[-•*]\s*/, '').trim()).filter(Boolean).forEach(line => list.append(el('li', '', line)));
      return list;
    }
    return el('p', 'lesson-text', block.text);
  }

  function renderPager(lesson) {
    const footer = el('footer', 'lesson-footer');
    const position = lessons.findIndex(item => item.id === lesson.id);
    const previous = lessons[position - 1];
    const next = lessons[position + 1];
    footer.append(previous ? pagerButton(previous, 'Предыдущий урок') : el('span'));

    const complete = el('button', 'complete-button', completed.has(lesson.id) ? '✓ Урок пройден' : 'Отметить пройденным');
    complete.type = 'button';
    complete.classList.toggle('done', completed.has(lesson.id));
    complete.addEventListener('click', () => {
      if (completed.has(lesson.id)) completed.delete(lesson.id); else completed.add(lesson.id);
      saveProgress();
      complete.classList.toggle('done', completed.has(lesson.id));
      complete.textContent = completed.has(lesson.id) ? '✓ Урок пройден' : 'Отметить пройденным';
    });
    footer.append(complete);
    footer.append(next ? pagerButton(next, 'Следующий урок') : el('span'));
    return footer;
  }

  function pagerButton(lesson, label) {
    const button = el('button', 'pager');
    button.type = 'button';
    button.append(el('span', '', label), el('strong', '', lesson.title));
    button.addEventListener('click', () => { location.hash = lesson.id; });
    return button;
  }

  function openLightbox(src, caption) {
    lightboxImage.src = src;
    lightboxImage.alt = caption;
    lightboxCaption.textContent = caption;
    lightbox.showModal();
  }

  function route() {
    const id = location.hash.slice(1);
    const lesson = byId.get(id);
    if (lesson) renderLesson(lesson); else renderOverview();
    closeMenu();
  }

  function openMenu() {
    sidebar.classList.add('open');
    scrim.classList.add('open');
    menuButton.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    sidebar.classList.remove('open');
    scrim.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  searchInput.addEventListener('input', event => renderNav(event.target.value));
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const first = nav.querySelector('.nav-lesson');
      if (first) first.click();
    }
  });
  menuButton.addEventListener('click', () => sidebar.classList.contains('open') ? closeMenu() : openMenu());
  scrim.addEventListener('click', closeMenu);
  document.querySelector('#closeLightbox').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', event => { if (event.target === lightbox) lightbox.close(); });
  window.addEventListener('hashchange', route);

  renderNav();
  updateProgress();
  route();
})();
