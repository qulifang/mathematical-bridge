(async () => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const response = await fetch('data/site.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('无法读取网站内容。');
  const seed = await response.json();
  let serverRevision = seed.revision;
  const names = { lesson: '课程讲义', system: '体系与约定', tool: '常用工具', session: '训练牌例', story: '实战复盘', photo: '活动照片' };
  const accepts = { lesson: '.ppt,.pptx,.pdf', system: '.doc,.docx,.pdf,.md,.txt', tool: '.zip,.7z,.rar,.pdf', session: '.pbn', photo: '.jpg,.jpeg,.png,.webp' };
  const seatNames = { N: '北', E: '东', S: '南', W: '西' };
  const vulNames = { None: '双方无局', NS: '南北有局', EW: '东西有局', All: '双方有局' };
  const suits = ['♠', '♥', '♦', '♣'];
  const solverBase = 'https://dds.bridgewebs.com/bsol_standalone/ddummy.htm';
  const boardCache = new WeakMap();
  let entries = seed.entries;
  let selection = { session: '', board: '' };
  let editId = '';
  let busy = false;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'click') node.addEventListener('click', value);
      else if (value !== undefined) node.setAttribute(key, value);
    }
    node.append(...children.flat().filter((child) => child != null));
    return node;
  }

  const p = (text, className = 'muted') => el('p', { class: className }, text);
  const empty = (text) => p(text, 'empty');
  const button = (text, click, style = 'quiet') =>
    el('button', { type: 'button', class: 'button ' + style, click }, text);
  const ofType = (type) => entries.filter((item) => item.type === type);
  const byId = (id) => entries.find((item) => item.id === id);
  const suffix = (name) => name.slice(name.lastIndexOf('.') + 1).toUpperCase();
  const fileLink = (item, text) =>
    el('a', { class: 'button quiet', href: (item.file.data || item.file.path), download: item.file.name }, text);

  function fileText(file) {
    const bytes = Uint8Array.from(atob(file.data.split(',')[1]), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function parsePbn(text) {
    const boards = [];
    const seen = new Set();
    for (const block of text.split(/(?=^\s*\[Board\s+")/mi)) {
      const tag = (name) => block.match(new RegExp('^\\s*\\[' + name + '\\s+"([^"]*)"\\]', 'mi'))?.[1]?.trim() ?? '';
      const number = tag('Board');
      if (!number) continue;
      const deal = tag('Deal').toUpperCase().match(/^([NESW]):\s*(.+)$/);
      if (!deal) throw new Error('第 ' + number + ' 副缺少完整的 Deal 牌面。');
      if (seen.has(number)) throw new Error('第 ' + number + ' 副出现重复牌号。请上传每副仅一条记录的训练牌文件。');
      seen.add(number);
      const start = 'NESW'.indexOf(deal[1]);
      const hands = {};
      const cards = new Set();
      const groups = deal[2].split(/\s+/);
      if (groups.length !== 4) throw new Error('第 ' + number + ' 副应有四手牌。');
      groups.forEach((group, index) => {
        const parts = group.split('.');
        if (parts.length !== 4 || parts.join('').length !== 13 ||
            parts.some((part) => !/^[AKQJT2-9]*$/.test(part))) {
          throw new Error('第 ' + number + ' 副有无法识别的手牌。');
        }
        hands['NESW'[(start + index) % 4]] = parts;
        parts.forEach((part, suit) => [...part].forEach((rank) => cards.add(suit + rank)));
      });
      if (cards.size !== 52) throw new Error('第 ' + number + ' 副有重复牌。');
      const vul = { none: 'None', love: 'None', ns: 'NS', ew: 'EW', all: 'All', both: 'All' }[tag('Vulnerable').toLowerCase()];
      const rawDealer = tag('Dealer').toUpperCase();
      const dealer = /^[NESW]$/.test(rawDealer) ? rawDealer : '';
      const rawDd = tag('DoubleDummyTricks').toLowerCase();
      let dd = /^[0-9a-d]{20}$/.test(rawDd) ? [...rawDd].map((value) => parseInt(value, 16)) : null;
      if (!dd && tag('OptimumResultTable')) {
        const rows = block.split(/\r?\n\[/).find((section) => section.startsWith('OptimumResultTable ')) ?? '';
        const positions = Array(20).fill(null);
        for (const match of rows.matchAll(/^\s*([NSEW])\s+(NT|[SHDC])\s+(1[0-3]|[0-9])\s*$/gm)) {
          positions['NSEW'.indexOf(match[1]) * 5 + ['NT', 'S', 'H', 'D', 'C'].indexOf(match[2])] = Number(match[3]);
        }
        if (positions.every((value) => value !== null)) dd = positions;
      }
      boards.push({ number, hands, dealer, vul, dd, optimum: tag('OptimumScore') });
    }
    if (!boards.length) throw new Error('没有找到可显示的牌。请确认文件含有 Board 和 Deal 字段。');
    return boards;
  }

  function boardsOf(item) {
    if (item.boards && !item.file.data) return item.boards;
    if (!boardCache.has(item)) boardCache.set(item, parsePbn(fileText(item.file)));
    return boardCache.get(item);
  }

  function solverLink(board) {
    if (!board.dealer || !board.vul) return solverBase;
    const params = new URLSearchParams({
      board: board.number.slice(0, 15), dealer: board.dealer, vul: board.vul, club: 'bridge-club', event: 'practice',
    });
    for (const [seat, name] of Object.entries({ N: 'north', E: 'east', S: 'south', W: 'west' })) {
      params.set(name, board.hands[seat].join('.'));
    }
    if (board.dd) params.set('dd', board.dd.map((value) => value.toString(16)).join(''));
    return solverBase + '?' + params.toString();
  }

  function drawPhoto(photo, hero = false, thumbnail = false) {
    return el('img', { src: thumbnail ? photo.file.thumbnail || photo.file.path || photo.file.data : photo.file.data || photo.file.path, alt: photo.description || photo.title || names.photo, loading: hero ? 'eager' : 'lazy' });
  }

  function drawResources() {
    const formats = { PPTX: 'PPT', PPT: 'PPT', DOC: 'Word', DOCX: 'Word', ZIP: 'ZIP', PDF: 'PDF', MD: 'Markdown', TXT: '文本' };
    $('resources').replaceChildren(...['lesson', 'system', 'tool'].map((type) => {
      const items = ofType(type);
      return el('article', { class: 'resource-group' },
        el('div', { class: 'resource-heading' }, el('h3', {}, names[type])),
        el('div', { class: 'resource-items', role: 'region', 'aria-label': names[type] + '条目', tabindex: '0' },
          ...items.map((item) => el('a', {
          class: 'download-row', href: item.library ? '#conventions' : item.file?.data || item.file?.path || item.href,
          download: item.file?.name, target: item.file || item.library ? undefined : '_blank',
          rel: item.file || item.library ? undefined : 'noopener noreferrer',
          'aria-label': (item.file ? '下载 ' : '打开 ') + item.title,
        }, el('span', { class: 'resource-title' }, item.title,
          item.description && !item.library ? el('small', { class: 'resource-description' }, item.description) : null),
          el('span', { class: 'format-badge' }, item.file ? formats[suffix(item.file.name)] || suffix(item.file.name) : item.linkLabel || '网页'),
          el('span', { class: 'download-arrow', 'aria-hidden': 'true' }, item.file ? '↓' : '↗'))),
          !items.length ? empty('暂未发布') : null));
    }));
  }

  function drawHand(board, seat, visible = true) {
    const points = [...board.hands[seat].join('')].reduce((sum, rank) => sum + ({ A: 4, K: 3, Q: 2, J: 1 }[rank] || 0), 0);
    return el('div', { class: 'hand', 'data-seat': seat },
      el('h4', {}, seat, visible ? el('small', {}, points + ' HCP') : null),
      ...(visible ? board.hands[seat].map((holding, index) => el('div', { class: 'cards' },
        el('span', { class: index === 1 || index === 2 ? 'red' : undefined }, suits[index]),
        el('span', {}, holding.replace(/T/g, '10') || '—')))
        : [el('div', { class: 'hidden-cards', 'aria-label': seat + ' 手牌隐藏' }, '•••')]));
  }

  function drawTable(board, visibleSeats = 'NESW', withDd = false) {
    const compass = el('div', { class: 'table-center', 'aria-label': '第 ' + board.number + ' 副；' +
      (vulNames[board.vul] || '局况未录') + '；' + (seatNames[board.dealer] || '') + '发牌' },
      el('b', { class: 'board-number' }, board.number),
      ...[...'NESW'].map((seat) => {
        const vulnerable = board.vul === 'All' || board.vul?.includes(seat === 'N' || seat === 'S' ? 'NS' : 'EW');
        return el('span', { class: 'compass-seat pos-' + seat + (vulnerable ? ' vulnerable' : '') +
          (seat === board.dealer ? ' dealer' : ''), 'aria-label': seat + (vulnerable ? ' 有局' : ' 无局') +
          (seat === board.dealer ? ' 发牌' : '') }, seat);
      }));
    return el('div', { class: 'table-felt', 'aria-label': '牌桌' },
      ...['N', 'W', 'E', 'S'].map((seat) => drawHand(board, seat, visibleSeats.includes(seat))), compass,
      withDd ? el('div', { class: 'felt-dd' }, p('双明手', 'felt-dd-label'), drawDdTable(board, true)) : null);
  }

  function drawDdTable(board, compact = false) {
    return board.dd ? el('table', { class: 'dd', 'aria-label': '双明手可得墩数' },
      el('thead', {}, el('tr', {}, [compact ? '' : '庄家', 'NT', ...suits].map((name) => el('th', { scope: 'col' }, name)))),
      el('tbody', {}, [...'NSEW'].map((seat, index) => el('tr', {},
        el('th', { scope: 'row' }, seat),
        ...board.dd.slice(index * 5, index * 5 + 5).map((value) =>
          el('td', {}, String(value))))))) : p('此文件未附双明手墩数。', 'muted small');
  }

  function drawAnalysis(board, related) {
    const known = board.dealer && board.vul;
    return el('div', { class: 'analysis', 'aria-live': 'polite' },
      el('h3', {}, '双明手分析'),
      drawDdTable(board),
      board.optimum && p('最佳结果 ' + board.optimum, 'muted small'),
      el('div', { class: 'actions' },
        el('a', { class: 'button solid', href: solverLink(board), target: '_blank', rel: 'noopener noreferrer' },
          known ? '在Bridge Solver中进行分析 ↗' : '打开 Bridge Solver ↗')),
      ...related.map((story) => el('a', { href: '#story/' + story.id, class: 'board-story' },
        '相关实战复盘 · ' + story.title + ' →')));
  }

  function drawLibrary(focus = '') {
    const root = $('board-library');
    const sessions = ofType('session');
    if (!sessions.length) {
      root.replaceChildren(empty('训练牌例暂未发布。'));
      return;
    }
    const session = sessions.find((item) => item.id === selection.session) || sessions[0];
    const boards = boardsOf(session);
    const board = boards.find((item) => item.number === selection.board) || boards[0];
    selection = { session: session.id, board: board.number };
    const related = ofType('story').filter((item) => item.session === session.id && item.board === board.number);
    const picker = el('select', { 'aria-label': '选择训练活动' },
      ...sessions.map((item) => el('option', { value: item.id }, item.title)));
    picker.value = session.id;
    picker.addEventListener('change', () => {
      selection = { session: picker.value, board: '' };
      drawLibrary('session');
    });
    const boardButtons = boards.map((item) => el('button', {
      type: 'button', 'aria-pressed': String(item.number === board.number), 'aria-label': '第 ' + item.number + ' 副',
      click: () => { selection.board = item.number; drawLibrary('board'); },
    }, item.number));
    root.replaceChildren(el('article', { class: 'panel' },
      el('div', { class: 'session-head' },
        el('div', {}, el('h3', {}, session.title),
          p([session.date, boards.length + ' 副训练牌', session.description].filter(Boolean).join(' · '), 'muted small')),
        el('div', { class: 'actions session-actions' }, sessions.length > 1 ? picker : null, fileLink(session, '下载整场 PBN ↓'))),
      el('div', { class: 'board-nav', 'aria-label': '选择牌号' }, boardButtons),
      el('div', { class: 'board-layout' },
        el('div', {},
          drawTable(board)),
        drawAnalysis(board, related))));
    if (focus === 'session') picker.focus();
    if (focus === 'board') boardButtons.find((node) => node.getAttribute('aria-pressed') === 'true')?.focus();
  }

  const categories = { '叫牌': '百家争鸣', '坐庄': '专家打法', '防守': '防守杀招' };
  const categoryKeys = { '叫牌': 'bidding', '坐庄': 'declarer', '防守': 'defense' };
  let galleryTimer;
  let galleryObserver;

  function drawStories() {
    $('story-list').replaceChildren(el('div', { class: 'story-categories' },
      ...Object.entries(categories).map(([category, title]) => {
        return el('article', { class: 'story-category' },
          el('a', { class: 'category-heading', href: '#category/' + categoryKeys[category] },
            el('h3', {}, title), el('span', { 'aria-hidden': 'true' }, '↗')));
      })));
    route();
  }

  function prettyBid(bid) {
    return bid.replace(/([1-7])([SHDC])/g, (_, level, suit) => level + ({S:'♠',H:'♥',D:'♦',C:'♣'}[suit]));
  }

  function storySections(item) {
    return item.sections || [['身在局中', item.thinking], ['实战过程', item.process], ['实战结果', item.result]]
      .filter((part) => part[1]).map(([title, body]) => ({title, body}));
  }

  function drawEndgame(board, endgame) {
    const table = drawTable(board);
    table.classList.add('endgame-table');
    for (const seat of 'NESW') {
      const hand = table.querySelector('[data-seat="' + seat + '"]');
      hand.querySelector('h4').replaceChildren(seat);
      hand.querySelectorAll('.cards').forEach((row, suit) => {
        const cards = row.lastElementChild;
        cards.replaceChildren(...[...board.hands[seat][suit]].map((rank) => {
          const remains = endgame.remaining[seat][suit].includes(rank);
          const current = seat === endgame.seat && 'SHDC'[suit] + rank === endgame.card;
          return el('span', {class: 'endgame-card' + (remains ? ' remaining' : ' played') + (current ? ' highlighted' : ''),
            'aria-label': suits[suit] + rank.replace('T','10') + (current ? '，当前出牌' : remains ? '，余牌' : '，已出')}, rank.replace('T','10'));
        }));
      });
    }
    return el('figure', {class:'endgame-figure', 'aria-label':seatNames[endgame.seat] + '家当前出牌残局'}, table);
  }

  function addSectionEditor(part = {title:'',body:''}) {
    const card = el('div', {class:'section-editor'});
    const title = el('input', {class:'section-title', maxlength:'100', value:part.title});
    const body = el('textarea', {class:'section-body', rows:'5', maxlength:'12000'}); body.value = part.body;
    card.append(el('div', {class:'section-editor-toolbar'},
      el('span', {class:'label'}, '内容段落'),
      el('div', {class:'actions'}, button('上移',()=>{if(card.previousElementSibling) card.before(card.previousElementSibling);}),
        button('下移',()=>{if(card.nextElementSibling) card.nextElementSibling.after(card);}), button('移除',()=>card.remove()))),
      el('label',{},'小标题（可自拟）',title), el('label',{},'正文（在插图位置填写 [[残局]]）',body));
    $('section-editors').append(card);
  }

  function drawStoryPage(item) {
    const session = byId(item.session);
    const board = session && boardsOf(session).find((record) => record.number === item.board);
    const header = el('div', { class: 'detail-heading' },
      el('a', { class: 'back-link', href: '#category/' + categoryKeys[item.category] }, '← ' + categories[item.category]),
      p(item.description || item.date || '', 'label'), el('h1', {}, item.title));
    const content = el('div', { class: 'story-content' });
    const steps = item.auction || [];
    const introduction = el('div', { class: 'story-intro' },
      ...storySections(item).map((part) => {
        const section = el('section', {}, part.title ? el('h3', {}, part.title) : null);
        const pieces = part.body.split('[[残局]]');
        pieces.forEach((text, index) => {
          if (text.trim()) section.append(p(text.trim(), 'prose'));
          if (index < pieces.length - 1 && item.endgame && board) section.append(drawEndgame(board, item.endgame));
        });
        return section;
      }));
    if (item.lead) content.append(p(item.lead, 'story-challenge'));
    if (!steps.length || !board) {
      content.append(board ? drawTable(board) : el('div'), introduction);
    } else {
      const viewSeat = item.viewSeat || item.contributorSeat || 'S';
      let step = 0;
      let full = false;
      const tableHost = el('div');
      const auctionHost = el('div', { class: 'auction-host' });
      const note = p('', 'auction-note');
      const counter = el('span', { class: 'label', 'aria-live': 'polite' });
      const previous = button('← 上一步', () => { step--; full = false; update(); });
      const next = button('下一步 →', () => { step++; full = false; update(); }, 'solid');
      const reveal = button('查看双明手结果', () => {
        full = !full;
        update();
      });
      const restart = button('回到开始', () => { step = 0; full = false; update(); });
      const update = () => {
        tableHost.replaceChildren(drawTable(board, full ? 'NESW' : viewSeat, full));
        const seats = [...'NESW'];
        const rows = [];
        for (let i = 0; i < steps.length; i++) {
          const turn = 'NESW'[('NESW'.indexOf(board.dealer) + i) % 4];
          let row = rows.at(-1);
          if (!row || turn === 'N') { row = Array(4).fill(null); rows.push(row); }
          row[seats.indexOf(turn)] = { bid: steps[i], index: i };
        }
        auctionHost.replaceChildren(el('table', { class: 'auction-table', 'aria-label': '逐步叫牌' },
          el('thead', {}, el('tr', {}, seats.map((seat) => el('th', {scope:'col'}, seat)))),
          el('tbody', {}, rows.map((row) => el('tr', {}, row.map((cell) =>
            el('td', { class: cell && cell.index === step - 1 ? 'current-bid' : '' },
              cell && cell.index < step ? prettyBid(cell.bid) : '·')))))));
        counter.textContent = step + ' / ' + steps.length;
        note.textContent = item.auctionNotes?.[String(step)] || '';
        note.hidden = !note.textContent;
        previous.disabled = step === 0;
        next.disabled = step === steps.length;
        reveal.textContent = full ? '返回单手视角' : '查看双明手结果';
        restart.hidden = step !== steps.length && !full;
      };
      content.append(el('div', { class: 'replay-grid' }, tableHost,
        el('div', { class: 'auction-panel' }, el('h3', {}, item.auctionTitle || '叫牌进程'), auctionHost,
          el('div', { class: 'actions step-actions' }, previous, counter, next), note,
          el('div', { class: 'actions replay-options' }, reveal, restart))), introduction);
      update();
    }
    const credit = item.contributor ? '本局' + seatNames[item.contributorSeat || 'S'] + '家为' + item.contributor + '。' : item.attribution;
    content.append(p(credit || '本局贡献者待补充。', 'story-attribution'));
    $('detail-page').replaceChildren(header, content);
  }

  function drawConventions() {
    const docs = seed.conventions || [];
    const groups = [...new Set(docs.map((item) => item.group))];
    const list = el('div', { class: 'convention-groups' });
    const search = el('input', { type: 'search', placeholder: '输入关键字进行查询', 'aria-label': '查找约定叫文档' });
    const draw = () => {
      const term = search.value.trim().toLowerCase();
      list.replaceChildren(...groups.map((group) => {
        const matches = docs.filter((item) => item.group === group && (item.title + group).toLowerCase().includes(term));
        const section = matches.length ? el('details', { class: 'convention-group' },
          el('summary', {}, el('span', {}, group)),
          el('div', { class: 'convention-links', role: 'region', 'aria-label': group + '文档', tabindex: '0' },
          ...matches.map((item) => el('a', { class: 'download-row', href: item.href, target: '_blank', rel: 'noopener noreferrer' },
            el('span', { class: 'resource-title' }, item.title),
            el('span', { class: 'format-badge' }, '语雀'),
            el('span', { class: 'download-arrow', 'aria-hidden': 'true' }, '↗'))))) : null;
        if (section) section.open = !!term;
        return section;
      }).filter(Boolean));
      if (!list.childElementCount) list.append(empty('未找到匹配的文档。'));
    };
    search.addEventListener('input', draw);
    $('detail-page').replaceChildren(
      el('a', { class: 'back-link', href: '#learn' }, '← 学习资料'),
      el('h1', {}, '桥牌约定叫资料库'),
      el('div', { class: 'convention-search' }, search),
      list,
      el('a', { class: 'button quiet', href: 'https://www.yuque.com/yuqueyonghugivnwz/nt2nh4',
        target: '_blank', rel: 'noopener noreferrer' }, '打开语雀总目录 ↗'));
    draw();
  }

  function route() {
    if (location.hash === '#conventions') {
      $('home').hidden = true;
      $('detail-page').hidden = false;
      drawConventions();
      return;
    }
    const match = location.hash.match(/^#(story|category)\/(.+)$/);
    $('home').hidden = !!match;
    $('detail-page').hidden = !match;
    if (!match) return;
    if (match[1] === 'story') {
      const item = byId(decodeURIComponent(match[2]));
      if (item?.type === 'story') { drawStoryPage(item); return; }
    } else {
      const category = Object.keys(categoryKeys).find((key) => categoryKeys[key] === match[2]);
      if (category) {
        $('detail-page').replaceChildren(
          el('a', { class: 'back-link', href: '#stories' }, '← 实战复盘'),
          el('h1', {}, categories[category]),
          el('div', { class: 'category-index' },
            ...ofType('story').filter((item) => item.category === category).map((item) =>
              el('a', {class:'story-title',href:'#story/' + item.id}, item.title, '↗'))));
        if (!$('detail-page').lastChild.childElementCount) $('detail-page').append(empty('待续'));
        return;
      }
    }
    $('detail-page').replaceChildren(empty('这篇内容已移除。'), el('a', {href:'#stories'}, '返回实战复盘'));
  }

  function drawGallery() {
    clearTimeout(galleryTimer);
    galleryObserver?.disconnect();
    const photos = ofType('photo');
    $('hero-media').replaceChildren(...(photos.length ? [drawPhoto(photos[0], true)] :
      [el('div', { class: 'suits-decoration', 'aria-hidden': 'true' }, '♠ ♥ ♦ ♣')]));
    const root = $('photo-list');
    if (!photos.length) { root.replaceChildren(empty('活动照片暂未发布。')); return; }
    let index = 0;
    let targetIndex = 0;
    let requestVersion = 0;
    let loading = false;
    let inView = false;
    let image = drawPhoto(photos[0]);
    let fade;
    const stage = el('div', { class: 'gallery-stage' }, image);
    const count = el('span', { class: 'photo-count', 'aria-live': 'off' });
    const thumbs = photos.map((photo, i) => el('button', { type:'button', 'aria-label':'查看第 ' + (i + 1) + ' 张照片',
      click:() => show(i) }, drawPhoto(photo, false, true)));
    const adjacent = new Map();
    const wrap = (i) => (i + photos.length) % photos.length;

    async function loadPhoto(i) {
      const next = drawPhoto(photos[i]);
      next.loading = 'eager';
      try {
        await next.decode();
        return next;
      } catch {
        return null;
      }
    }

    function preloadAdjacent() {
      const neighbors = inView && photos.length > 1 ? [wrap(index - 1), wrap(index + 1)] : [];
      for (const i of adjacent.keys()) {
        if (!neighbors.includes(i)) adjacent.delete(i);
      }
      for (const i of neighbors) {
        if (!adjacent.has(i)) adjacent.set(i, loadPhoto(i));
      }
    }

    function updateSelection() {
      image.alt = '活动照片 ' + (index + 1);
      count.textContent = String(index + 1).padStart(2,'0') + ' / ' + String(photos.length).padStart(2,'0');
      thumbs.forEach((thumb, n) => thumb.setAttribute('aria-pressed', String(n === index)));
    }

    function schedule() {
      if (!stage.isConnected) return;
      clearTimeout(galleryTimer);
      if (!inView || loading || photos.length < 2) return;
      galleryTimer = setTimeout(() => {
        if (!document.hidden && !$('home').hidden) show(targetIndex + 1);
        else schedule();
      }, 6000);
    }

    async function show(i) {
      targetIndex = wrap(i);
      const target = targetIndex;
      const version = ++requestVersion;
      clearTimeout(galleryTimer);
      loading = target !== index;
      if (!loading) { schedule(); return; }

      const next = await (adjacent.get(target) || loadPhoto(target));
      if (version !== requestVersion || !stage.isConnected) return;
      adjacent.delete(target);
      loading = false;
      if (next) {
        fade?.cancel();
        const outgoing = image;
        image = next;
        index = target;
        updateSelection();
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
          stage.replaceChildren(image);
        } else {
          outgoing.setAttribute('aria-hidden', 'true');
          stage.replaceChildren(outgoing, image);
          fade = image.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' });
          fade.onfinish = () => outgoing.remove();
        }
      }
      preloadAdjacent();
      schedule();
    }

    root.replaceChildren(stage, el('div', { class:'gallery-toolbar' }, count,
      el('div', { class:'actions' },
        button('←', () => show(targetIndex - 1)),
        button('→', () => show(targetIndex + 1)))),
      el('div', { class:'photo-thumbnails', 'aria-label':'照片索引' }, thumbs));
    updateSelection();
    galleryObserver = new IntersectionObserver(([entry]) => {
      if (!stage.isConnected) return;
      inView = entry.isIntersecting;
      preloadAdjacent();
      schedule();
    });
    galleryObserver.observe(root);
  }

  function render() {
    drawResources();
    drawLibrary();
    drawStories();
    drawGallery();
  }

  const status = (message) => { $('manage-status').textContent = message; };
  function fields() {
    return $('editor').elements;
  }
  function changeBoardOptions(current = '') {
    const controls = fields();
    const session = byId(controls.session.value);
    controls.board.replaceChildren(...(session
      ? boardsOf(session).map((board) => el('option', { value: board.number }, '第 ' + board.number + ' 副'))
      : [el('option', { value: '' }, '—')]));
    if (current && [...controls.board.options].some((option) => option.value === current)) controls.board.value = current;
    controls.board.disabled = !session;
  }

  function updateFields(existing) {
    const controls = fields();
    const type = controls.type.value;
    const isStory = type === 'story';
    const isPhoto = type === 'photo';
    const isResource = ['lesson', 'system', 'tool'].includes(type);
    const isLink = isResource && controls.resourceMode.value === 'link';
    $('title-field').hidden = isPhoto;
    controls.title.disabled = isPhoto;
    controls.title.required = !isPhoto;
    $('resource-mode-field').hidden = !isResource;
    controls.resourceMode.disabled = !isResource;
    $('resource-url-field').hidden = !isLink;
    controls.href.disabled = !isLink;
    controls.href.required = isLink;
    $('file-field').hidden = isStory || isLink;
    controls.file.disabled = isStory || isLink;
    controls.file.accept = accepts[type] || '';
    $('file-tip').textContent = existing?.file
      ? '当前：' + existing.file.name + '。重新选择即可替换。'
      : (accepts[type] || '').replaceAll(',', ' / ') + ' · 每份最多 15 MB';
    for (const id of ['category', 'story-session', 'story-board', 'story-auction', 'story-custom']) {
      $(id + '-field').hidden = !isStory;
    }
    $('description-label').textContent = isStory ? '背景或给读者的问题（可选）' : '简介（可选）';
    controls.contributor.required = isStory;
    controls.session.replaceChildren(el('option', { value: '' }, '不关联'),
      ...ofType('session').map((item) => el('option', { value: item.id }, item.title)));
    controls.session.value = existing?.session && byId(existing.session) ? existing.session : '';
    changeBoardOptions(existing?.board);
  }

  function startEdit(item) {
    editId = item?.id || '';
    $('editor').reset();
    const controls = fields();
    controls.type.disabled = !!item;
    if (item) {
      for (const key of ['type', 'title', 'date', 'description', 'category']) {
        if (item[key] != null) controls[key].value = item[key];
      }
    }
    if (item?.auction) controls.auction.value = item.auction.join(' ');
    controls.lead.value = item?.lead || '';
    controls.contributor.value = item?.contributor || '';
    controls.contributorSeat.value = item?.contributorSeat || 'S';
    controls.viewSeat.value = item?.viewSeat || '';
    controls.auctionTitle.value = item?.auctionTitle || '叫牌进程';
    controls.auctionNotes.value = Object.entries(item?.auctionNotes || {}).map(([step, text])=>step + ' | ' + text).join('\n');
    $('section-editors').replaceChildren();
    for (const part of item ? storySections(item) : [{title:'',body:''}]) addSectionEditor(part);
    for (const seat of 'NESW') controls['remaining' + seat].value = item?.endgame?.remaining[seat].map(s=>s || '—').join(' / ') || '';
    controls.highlightSeat.value = item?.endgame?.seat || 'N';
    controls.highlightCard.value = item?.endgame?.card || '';

    controls.resourceMode.value = item?.href ? 'link' : 'file';
    controls.href.value = item?.href || '';
    updateFields(item);
    if (item) (item.type === 'photo' ? controls.file : controls.title).focus();
  }

  function manageName(item) {
    return item.type === 'photo' ? item.file?.name || names.photo : item.title;
  }

  function renderManageList() {
    $('manage-list').replaceChildren(...entries.map((item) => el('div', { class: 'manage-row' },
      el('div', {}, el('b', {}, manageName(item)), p(names[item.type] + (item.date ? ' · ' + item.date : ''), 'muted small')),
      el('div', { class: 'actions' }, button('编辑', () => { startEdit(item); status('正在编辑：' + manageName(item)); }),
        item.file ? fileLink(item, '下载') : null, button('删除', () => removeItem(item), 'quiet danger')))));
  }

  async function commit(next, message) {
    const response = await fetch('api/catalog', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: serverRevision, entries: next }),
    });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || '保存失败。');
    serverRevision = saved.revision;
    entries = saved.entries;
    render();
    startEdit();
    renderManageList();
    status(message);
  }

  async function removeItem(item) {
    if (busy) return;
    const related = item.type === 'session' && entries.some((record) => record.session === item.id);
    const prompt = '从网页删除「' + manageName(item) + '」？' + (related ? '关联复盘会保留正文，并解除牌号关联。' : '');
    if (!confirm(prompt)) return;
    busy = true;
    try {
      const next = entries.filter((record) => record.id !== item.id).map((record) =>
        record.session === item.id ? { ...record, session: '', board: '' } : record);
      await commit(next, '已从网页移除。');
    } catch (error) {
      status(error.message);
    } finally {
      busy = false;
    }
  }

  function readAsset(file, type) {
    const extension = '.' + suffix(file.name).toLowerCase();
    if (!accepts[type].split(',').includes(extension)) throw new Error('文件类型不符合当前栏目。');
    if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('文件需大于 0，且不超过 15 MB。');
    if (type === 'photo') return preparePhoto(file);
    const mime = type === 'photo'
      ? ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[extension])
      : 'application/octet-stream';
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, data: 'data:' + mime + ';base64,' + reader.result.split(',')[1] });
      reader.onerror = () => reject(new Error('无法读取该文件。'));
      reader.readAsDataURL(file);
    });
  }

  async function preparePhoto(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const renderSize = (width, height, quality) => {
      const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', quality);
    };
    try {
      return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
        data: renderSize(1440, 1080, 0.88), thumbnailData: renderSize(240, 180, 0.78) };
    } finally { bitmap.close(); }
  }

  function newId() {
    return globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  async function saveItem(event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const controls = fields();
      const previous = byId(editId);
      const type = previous?.type || controls.type.value;
      const item = { ...previous, id: editId || newId(), type,
        title: type === 'photo' ? previous?.title || '' : controls.title.value.trim(),
        date: controls.date.value, description: controls.description.value.trim() };
      if (type !== 'photo' && !item.title) throw new Error('请填写标题。');
      if (type === 'story') {
        Object.assign(item, { category: controls.category.value, session: controls.session.value,
          board: controls.board.value, lead: controls.lead.value.trim(), contributor:controls.contributor.value.trim(),
          contributorSeat:controls.contributorSeat.value, viewSeat:controls.viewSeat.value,
          auctionTitle:controls.auctionTitle.value.trim() });
        if (!item.contributor) throw new Error('请填写本局署名。');
        item.sections = [...$('section-editors').children].map(card=>({title:card.querySelector('.section-title').value.trim(),body:card.querySelector('.section-body').value.trim()})).filter(part=>part.title || part.body);
        item.auctionNotes = {};
        for (const line of controls.auctionNotes.value.split('\n').filter(line=>line.trim())) {
          const match = line.match(/^\s*(\d+)\s*[|｜]\s*(.+)$/);
          if (!match) throw new Error('叫品提示格式：第几个叫品 | 说明，每行一条。');
          item.auctionNotes[match[1]] = match[2].trim();
        }
        const remaining = {};
        for (const seat of 'NESW') {
          remaining[seat] = controls['remaining' + seat].value.trim().toUpperCase().replaceAll('10','T').split('/').map(s=>s.replace(/[\s—-]/g,''));
        }
        if ([...'NESW'].some(seat=>controls['remaining'+seat].value.trim())) {
          item.endgame = {remaining,seat:controls.highlightSeat.value,card:controls.highlightCard.value.trim().toUpperCase().replace('10','T')};
        } else delete item.endgame;
        const auction = controls.auction.value.trim().split(/\s+/).filter(Boolean).map((bid) => bid.toUpperCase()
          .replaceAll('♠','S').replaceAll('♥','H').replaceAll('♦','D').replaceAll('♣','C'));
        if (auction.some((bid) => !/^(PASS|X|XX|[1-7](NT|[SHDC]))$/.test(bid))) throw new Error('叫牌请使用 1D、4NT、Pass、X 等格式，以空格分隔。');
        if (auction.length) item.auction = auction.map((bid) => bid === 'PASS' ? 'Pass' : bid);
        else delete item.auction;
        if (!item.sections.some(part=>part.body)) throw new Error('请至少填写一段复盘内容。');
      } else if (['lesson', 'system', 'tool'].includes(type) && controls.resourceMode.value === 'link') {
        const url = new URL(controls.href.value.trim());
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('请填写 http 或 https 网页地址。');
        item.href = url.href;
        delete item.file;
        if (previous?.href && previous.href !== item.href) {
          delete item.library;
          delete item.linkLabel;
        }
      } else {
        const file = controls.file.files[0];
        item.file = file ? await readAsset(file, type) : previous?.file;
        if (!item.file) throw new Error('请选择一个本地文件。');
        delete item.href;
        delete item.linkLabel;
        delete item.library;
      }
      const validBoards = type === 'session' ? new Set(boardsOf(item).map((board) => board.number)) : null;
      const next = previous
        ? entries.map((record) => {
          if (record.id === item.id) return item;
          if (validBoards && record.session === item.id && !validBoards.has(record.board)) {
            return { ...record, session: '', board: '' };
          }
          return record;
        })
        : [...entries, item];
      await commit(next, '已保存「' + manageName(item) + '」。');
    } catch (error) {
      status(error.message || '保存失败，请重试。');
    } finally {
      busy = false;
    }
  }

  async function downloadPackage(endpoint, name) {
    if (busy) { status('请等待当前条目保存完成。'); return; }
    busy = true;
    status('正在准备文件，请稍候。');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '生成失败。');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = el('a', { href: url, download: name });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status('已生成下载文件。');
    } catch (error) { status(error.message); }
    finally { busy = false; }
  }

  function initialize() {
    if (seed.editable) {
      $('manage-open').hidden = false;
      $('manage-open').addEventListener('click', () => {
        renderManageList(); startEdit(); status(''); $('manager').showModal();
      });
      $('manage-close').addEventListener('click', () => $('manager').close());
      $('editor').addEventListener('submit', saveItem);
      $('add-story-section').addEventListener('click', () => addSectionEditor());
      $('edit-type').addEventListener('change', () => updateFields());
      fields().resourceMode.addEventListener('change', () => updateFields(byId(editId)));
      fields().session.addEventListener('change', () => changeBoardOptions());
      $('edit-reset').addEventListener('click', () => { startEdit(); status(''); });
      $('export-editable').addEventListener('click', () => downloadPackage('api/backup', 'Mathematical-Bridge-维护备份.zip'));
      $('export-reader').addEventListener('click', () => downloadPackage('api/build', 'Mathematical-Bridge-发布包.zip'));
    }
    render();
  }
  document.addEventListener('click', (event) => {
    if (event.target.closest('a,button,input,select,textarea,summary,dialog,[contenteditable]') ||
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.querySelectorAll('.click-card').length >= 24) return;
    const omittedSuit = Math.floor(Math.random() * suits.length);
    suits.filter((_, index) => index !== omittedSuit).forEach((suit, index) => {
      const color = suit === '♥' || suit === '♦' ? ' red' : '';
      const card = el('span', { class: 'click-card' + color, 'aria-hidden': 'true' }, suit);
      card.style.left = event.clientX + 'px';
      card.style.top = event.clientY + 'px';
      document.body.append(card);
      const animation = card.animate([
        { transform: 'translate(-50%, -50%) rotate(0deg) scale(.5)', opacity: 0.9 },
        { transform: 'translate(' + ((index - 1) * 36 - 12) + 'px,-70px) rotate(' + ((index - 1) * 35) + 'deg) scale(1)', opacity: 0 },
      ], { duration: 700, easing: 'ease-out' });
      animation.onfinish = () => card.remove();
    });
  });
  window.addEventListener('hashchange', () => { route(); if (/^#(story|category)\//.test(location.hash) ||
    location.hash === '#conventions') window.scrollTo(0, 0); });
  initialize();
})().catch((error) => {
  const notice = document.createElement('p');
  notice.setAttribute('role', 'alert');
  notice.textContent = '网页加载失败。请通过网站地址或项目的本地预览程序打开。' + error.message;
  document.body.prepend(notice);
});
