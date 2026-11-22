(() => {
  const B = window.Bridge;
  const M = window.BridgeMatch;
  const byId = id => document.getElementById(id);
  const names = { N: '北', E: '东', S: '南', W: '西' };
  const symbols = { S: '♠', H: '♥', D: '♦', C: '♣', NT: 'NT' };
  const storageKey = 'bridge-table-boards-v1';
  const matchKey = 'bridge-table-matches-v1';
  const filePattern = /^(image\/(jpeg|png|webp))$/;
  const recognitionUrl = document.querySelector('meta[name="bridge-recognition-url"]').content;
  const newBoard = number => ({
    number, ...B.boardDefaults(number), date: B.localDate(), calls: [], tricks: null,
    deal: B.emptyDeal(), confirmed: false, finding: '',
    photoId: crypto.randomUUID?.() ?? 'photo-' + Date.now() + '-' + Math.random().toString(36).slice(2),
  });
  const photoKey = item => item.photoId ?? item.number;
  function stored(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  const emptyBook = () => ({ index: -1, boards: [] });
  function restoreBook(book) {
    if (!Array.isArray(book?.boards)) return emptyBook();
    if (!book.boards[book.index]) book.index = book.boards.length ? 0 : -1;
    return book;
  }
  let solo = restoreBook(stored(storageKey));
  let matches = stored(matchKey, { active: null, books: {} });
  if (!matches?.books || typeof matches.books !== 'object') matches = { active: null, books: {} };
  if (!M.validCode(matches.active?.code) || !M.validRoom(matches.active?.room) || !matches.books[matches.active.code]?.tables) {
    matches.active = null;
  }
  const activeMatch = () => matches.active ? matches.books[matches.active.code] : null;
  const latestBooks = () => stored(matchKey, matches).books ?? matches.books;
  let session = matches.active ? restoreBook(activeMatch().tables[matches.active.room]) : solo;
  let draft = newBoard(1);
  const board = () => session.boards[session.index] ?? draft;
  const byNumber = number => session.boards.findIndex(item => item.number === number);
  let stage = 'auction';
  let level = 1;
  let photoURL = null;
  let activePhoto = null;
  let recognition = null;
  let photoRequest = 0;
  let manualEntry = false;
  let edit = null;
  let pendingDelete = null;
  let noticeTimer;
  let photosDatabase;
  const selectedVersions = new Map();

  function say(message) {
    const notice = byId('notice');
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
  }

  function persist(value = session) {
    if (matches.active) {
      const { code, room } = matches.active;
      const books = latestBooks();
      const book = books[code] ?? activeMatch();
      return saveMatches({ ...matches, books: { ...books,
        [code]: { ...book, tables: { ...book.tables, [room]: value } } } });
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
      solo = value;
      return true;
    } catch {
      say('记录未保存，可先导出 PBN');
      return false;
    }
  }

  function saveMatches(value) {
    try {
      localStorage.setItem(matchKey, JSON.stringify(value));
      matches = value;
      return true;
    } catch {
      say('比赛记录未保存，可先复制成绩');
      return false;
    }
  }

  function save() {
    if (session.index === -1) {
      session.index = session.boards.push(draft) - 1;
      byId('board-count').textContent = session.boards.length;
    }
    persist();
  }

  function photos() {
    if (!photosDatabase) {
      photosDatabase = new Promise((resolve, reject) => {
        const request = indexedDB.open('bridge-table-photos', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('photos');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return photosDatabase;
  }

  async function updatePhoto(key, file) {
    const db = await photos();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('photos', 'readwrite');
      const store = transaction.objectStore('photos');
      if (file) store.put(file, key);
      else store.delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function caption(call) {
    return /^\d/.test(call) ? call[0] + symbols[call.slice(1).replace(/X+$/, '')] + (call.match(/X+$/)?.[0] ?? '') : call;
  }
  const formatPoints = points => points > 0 ? '+' + points : String(points);
  function trickOutcome(bid, tricks) {
    const delta = tricks - (Number(bid[0]) + 6);
    return delta === 0 ? 'make' : delta > 0 ? '超 ' + delta : '宕 ' + Math.abs(delta);
  }
  function red(value) { return /[HD]/.test(value); }
  const showCard = card => card[1] + card[0];
  const missingFrom = deal => B.fullDeck.filter(card => !B.seats.some(seat => deal[seat].includes(card)));
  function button(label, handler, className = '') {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = className;
    item.textContent = label;
    item.addEventListener('click', handler);
    return item;
  }

  function renderAuction(state) {
    const start = B.seats.indexOf(board().dealer);
    const calls = board().calls;
    const head = byId('seat-headers');
    head.replaceChildren();
    B.seats.forEach(seat => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = names[seat];
      head.append(cell);
    });
    const body = byId('auction-lines');
    body.replaceChildren();
    const end = start + calls.length;
    const slots = Math.max(4, Math.ceil((end + (state.done ? 0 : 1)) / 4) * 4);
    let row;
    for (let i = 0; i < slots; i++) {
      if (i % 4 === 0) row = body.insertRow();
      const cell = row.insertCell();
      const call = calls[i - start];
      if (call) {
        cell.textContent = caption(call);
        if (red(call)) cell.className = 'red';
      } else if (!state.done && i === end) {
        cell.className = 'next';
        cell.setAttribute('aria-label', '当前叫牌方位');
      }
    }
    byId('turn').textContent = state.done
      ? state.contract === 'Pass' ? '四家 Pass' : names[state.declarer] + '家 ' + caption(state.contract)
      : '轮到' + names[state.next] + '家';
    byId('bid-entry').hidden = state.done;
    byId('auction-finished').hidden = !state.done;
    byId('undo').disabled = !calls.length;
    let minLevel = Math.max(1, Math.floor((state.highest + 1) / 5) + 1);
    if (!state.done && state.highest === 34) minLevel = 7;
    level = Math.max(level, minLevel);
    [...byId('levels').children].forEach((item, i) => {
      item.disabled = (i + 1) * 5 - 1 <= state.highest;
      item.setAttribute('aria-pressed', String(i + 1 === level));
    });
    [...byId('bids').children].forEach((item, i) => {
      item.textContent = level + symbols[B.denominations[i]];
      item.disabled = (level - 1) * 5 + i <= state.highest;
    });
    document.querySelector('[data-call="X"]').disabled = !state.double;
    document.querySelector('[data-call="XX"]').disabled = !state.redouble;
  }

  function renderResult(state) {
    const area = byId('result-controls');
    area.replaceChildren();
    const hasResult = Number.isInteger(board().tricks);
    const score = B.duplicateScore(board(), state);
    byId('board-score').hidden = score === null;
    if (score !== null) {
      byId('score-ns').textContent = formatPoints(score);
      byId('score-ew').textContent = formatPoints(-score);
    }
    byId('result-state').textContent = !state.done ? '叫牌中' : state.contract === 'Pass' || hasResult ? '已记录' : '待录';
    if (!state.done) return;
    if (state.contract === 'Pass') {
      const text = document.createElement('p');
      text.className = 'muted';
      text.textContent = '四家 Pass';
      area.append(text);
      return;
    }
    const banner = document.createElement('div');
    banner.className = 'result-banner';
    const contract = document.createElement('strong');
    contract.textContent = caption(state.contract);
    const declarer = document.createElement('span');
    declarer.textContent = names[state.declarer] + '家主打';
    banner.append(contract, declarer);
    if (hasResult) {
      const outcome = document.createElement('span');
      outcome.className = 'result-outcome';
      outcome.textContent = trickOutcome(state.bid, board().tricks);
      banner.append(outcome);
    }
    const label = document.createElement('p');
    label.className = 'caption';
    label.textContent = '庄家赢墩';
    const group = document.createElement('div');
    group.className = 'tricks';
    for (let number = 0; number <= 13; number++) {
      const item = button(String(number), () => { board().tricks = number; save(); render(); });
      item.setAttribute('aria-pressed', String(number === board().tricks));
      group.append(item);
    }
    area.append(banner, label, group);
  }

  function renderReview() {
    const current = board();
    const show = manualEntry || B.seats.some(seat => current.deal[seat]?.length);
    const ready = show && B.validateDeal(current.deal);
    byId('review').hidden = !show;
    const status = byId('photo-state');
    status.textContent = current.confirmed ? '已确认' : show ? '待确认'
      : activePhoto ? (recognitionUrl ? '待识别' : '待录牌') : '';
    status.hidden = !status.textContent;
    byId('confirm').disabled = !ready || current.confirmed;
    byId('confirm').textContent = current.confirmed ? '牌面已确认' : '确认四手牌';
    const hands = byId('hands');
    const fill = byId('fill-hand');
    const candidates = byId('missing-cards');
    fill.hidden = true;
    candidates.hidden = true;
    hands.replaceChildren();
    if (!show) return;
    const missing = missingFrom(current.deal);
    const short = B.seats.filter(seat => current.deal[seat].length < 13);
    B.seats.forEach(seat => {
      const hand = document.createElement('article');
      hand.className = short.includes(seat) ? 'hand incomplete' : 'hand';
      const top = document.createElement('div');
      top.className = 'hand-title';
      const text = document.createElement('strong');
      const count = document.createElement('span');
      count.className = 'hand-count';
      count.textContent = current.deal[seat].length + '/13';
      text.append(names[seat], ' ', count);
      top.append(text);
      if (short.includes(seat)) top.append(button('补牌', () => openPicker(seat, null), 'text-button'));
      hand.append(top);
      B.suits.forEach(suit => {
        const line = document.createElement('div');
        line.className = 'suit-line' + (red(suit) ? ' red' : '');
        const label = document.createElement('strong');
        label.textContent = suit;
        const list = document.createElement('div');
        list.className = 'cards';
        const cards = [...B.ranks].map(rank => rank + suit).filter(card => current.deal[seat].includes(card));
        if (!cards.length) list.textContent = '—';
        cards.forEach(card => {
          const item = button(card[0], () => openPicker(seat, card));
          item.setAttribute('aria-label', showCard(card));
          list.append(item);
        });
        line.append(label, list);
        hand.append(line);
      });
      hands.append(hand);
    });
    byId('deal-message').textContent = ready
      ? current.finding?.replace(/。$/u, '') || '52/52 张'
      : (52 - missing.length) + '/52 张';
    if (!ready && missing.length) {
      candidates.hidden = false;
      candidates.textContent = '未分配牌 ' + missing.map(showCard).join(' ');
      if (short.length === 1 && 13 - current.deal[short[0]].length === missing.length) {
        const seat = short[0];
        fill.hidden = false;
        fill.textContent = '将剩下 ' + missing.length + ' 张补给' + names[seat] + '家';
        fill.onclick = () => {
          current.deal[seat].push(...missing);
          current.finding = '余牌已自动补齐';
          save();
          render();
        };
      }
    }
  }

  function render() {
    const current = board();
    byId('board-count').textContent = session.boards.length;
    const room = byId('match-current');
    room.hidden = !matches.active;
    room.textContent = matches.active ? M.rooms[matches.active.room] + '　' + matches.active.code : '';
    const boardNumber = byId('board-number');
    const oldOption = boardNumber.querySelector('[data-saved-board]');
    oldOption?.remove();
    if (!B.boardNumbers.includes(current.number)) {
      const option = new Option('第 ' + current.number + ' 副', current.number);
      option.dataset.savedBoard = '';
      boardNumber.add(option);
    }
    boardNumber.value = current.number;
    byId('dealer').value = current.dealer;
    byId('vul').value = current.vul;
    const state = B.auction(current.dealer, current.calls);
    const strain = state.done && state.bid ? state.bid.slice(1) : '';
    const compass = byId('compass-strain');
    compass.textContent = symbols[strain] ?? '';
    compass.classList.toggle('warm-suit', red(strain));
    renderAuction(state);
    renderResult(state);
    renderReview();
    const ready = B.canExport(current);
    byId('export').disabled = !ready;
    const hint = byId('export-hint');
    hint.hidden = ready;
    hint.textContent = ready ? '' : !state.done ? '叫牌未完'
      : state.contract !== 'Pass' && !Number.isInteger(current.tricks) ? '未录赢墩'
      : '牌面未确认';
  }

  function showStage(name, scroll = true) {
    stage = name;
    ['auction', 'result', 'photo'].forEach(panel => { byId(panel).hidden = panel !== stage; });
    document.querySelectorAll('.steps button').forEach(item => {
      if (item.dataset.stage === stage) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    if (scroll) window.scrollTo(0, 0);
  }

  function call(value) {
    const current = board();
    const state = B.auction(current.dealer, current.calls);
    if (state.done) return;
    current.calls.push(value);
    current.tricks = null;
    save();
    render();
  }
  function undo() {
    const current = board();
    if (!current.calls.length) return;
    current.calls.pop();
    current.tricks = null;
    level = 1;
    save();
    render();
  }

  function openPicker(seat, original) {
    edit = { seat, original };
    byId('card-title').textContent = names[seat] + (original ? '家换牌' : '家补牌');
    byId('remove-card').hidden = !original;
    const picker = byId('card-picker');
    picker.replaceChildren();
    const deal = board().deal;
    const owners = new Map(B.seats.flatMap(where => deal[where].map(card => [card, where])));
    function pickButton(card) {
      const owner = owners.get(card);
      const label = symbols[card[1]] + card[0] + (owner && owner !== seat ? names[owner] : '');
      const item = button(label, () => changeCard(card), (red(card) ? 'red ' : '') + (owner ? '' : 'unassigned'));
      item.disabled = owner === seat || (!original && deal[seat].length >= 13);
      return item;
    }
    const missing = original ? [] : B.fullDeck.filter(card => !owners.has(card));
    if (missing.length) {
      const label = document.createElement('p');
      label.className = 'caption';
      label.textContent = '未分配的牌';
      const row = document.createElement('div');
      row.className = 'picker-unassigned';
      row.append(...missing.map(pickButton));
      const group = document.createElement('div');
      group.append(label, row);
      picker.append(group);
    }
    B.suits.forEach(suit => {
      const cards = B.fullDeck.filter(card => card[1] === suit && (original || owners.has(card)));
      if (!cards.length) return;
      const row = document.createElement('div');
      row.className = 'picker-suit';
      row.append(...cards.map(pickButton));
      picker.append(row);
    });
    byId('card-dialog').showModal();
  }
  function changeCard(card) {
    const current = board();
    const { seat, original } = edit;
    const owner = card && B.seats.find(where => current.deal[where].includes(card));
    if (original) current.deal[seat] = current.deal[seat].filter(item => item !== original);
    if (owner && owner !== seat) {
      current.deal[owner] = current.deal[owner].filter(item => item !== card);
      if (original) current.deal[owner].push(original);
    }
    if (card) current.deal[seat].push(card);
    current.confirmed = false;
    current.finding = '';
    byId('card-dialog').close();
    save();
    render();
  }

  function setPhoto(file) {
    recognition?.abort();
    if (photoURL) URL.revokeObjectURL(photoURL);
    activePhoto = file;
    photoURL = file ? URL.createObjectURL(file) : null;
    const image = byId('image-preview');
    if (photoURL) image.src = photoURL;
    else image.removeAttribute('src');
    byId('image-area').hidden = !file;
    byId('detect').disabled = false;
    byId('detect').textContent = '识别四手牌';
    byId('recognition-message').textContent = '';
    renderReview();
  }

  async function loadPhoto() {
    manualEntry = false;
    const version = ++photoRequest;
    const key = photoKey(board());
    setPhoto(null);
    try {
      const db = await photos();
      const request = db.transaction('photos').objectStore('photos').get(key);
      request.onsuccess = () => {
        if (version === photoRequest && request.result) setPhoto(request.result);
      };
    } catch {}
  }

  async function preparePhoto(file) {
    const objectURL = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectURL;
      await image.decode();
      const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error()), 'image/jpeg', .92));
    } finally { URL.revokeObjectURL(objectURL); }
  }

  async function choosePhoto(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const current = board();
    save();
    const version = ++photoRequest;
    const key = photoKey(current);

    selectedVersions.set(key, version);
    setPhoto(null);
    byId('recognition-message').textContent = '处理照片…';
    let normalized;
    try { normalized = await preparePhoto(file); }
    catch {
      if (filePattern.test(file.type) && file.size <= 10 * 1024 * 1024) normalized = file;
      else {
        if (version === photoRequest) byId('recognition-message').textContent = '照片读不出来，请换一张';
        return;
      }
    }
    if (version === photoRequest) setPhoto(normalized);
    if (selectedVersions.get(key) !== version) return;
    try { await updatePhoto(key, normalized); }
    catch { if (version === photoRequest) say('照片未保存，离开页面后会丢失'); }
  }

  async function detectPhoto() {
    if (!recognitionUrl || !activePhoto) return;
    const current = board();
    const version = photoRequest;
    const controller = new AbortController();
    recognition = controller;
    const timeout = setTimeout(() => controller.abort(), 65000);
    const control = byId('detect');
    const message = byId('recognition-message');
    message.textContent = '';
    control.disabled = true;
    control.textContent = '识别中…';
    try {
      const form = new FormData();
      form.set('photo', activePhoto, 'bridge-photo');
      const response = await fetch(recognitionUrl, { method: 'POST', body: form,
        credentials: 'omit', signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '识别失败，请稍后重试');
      const deal = B.parseObservedDeal(result.pbn ?? '');
      if (!deal) throw new Error('没识别出牌面');
      if (version !== photoRequest) return;
      current.deal = deal;
      current.confirmed = false;
      current.finding = Number.isInteger(result.detected) && result.detected < 52
        ? '识别到 ' + result.detected + '/52 张，牌面可能含推补' : '';
      save();
      render();
      byId('review').scrollIntoView({ block: 'nearest' });
    } catch (error) {
      if (version !== photoRequest) return;
      message.textContent = error.name === 'AbortError' ? '识别超时，可重试'
        : error instanceof TypeError ? '识别服务连不上，照片还在本机' : error.message;
    } finally {
      clearTimeout(timeout);
      if (recognition === controller) {
        recognition = null;
        control.disabled = false;
        control.textContent = '识别四手牌';
      }
    }
  }

  function download(boards) {
    const fileName = boards.length === 1 ? 'bridge-board-' + boards[0].number + '.pbn' : 'bridge-session.pbn';
    const data = new Blob([B.exportPbn(boards)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    say('已导出 ' + fileName);
  }

  function switchBoard(index) {

    session.index = index;
    level = 1;
    byId('list-dialog').close();
    byId('deal-input').value = '';
    save();
    loadPhoto();
    showStage('auction');
    render();
  }

  function selectBoard(number) {
    const existing = byNumber(number);
    if (existing >= 0) { switchBoard(existing); return; }
    if (!B.boardNumbers.includes(number)) return;
    session.boards.push(session.index === -1 && draft.number === number ? draft : newBoard(number));
    switchBoard(session.boards.length - 1);
  }

  function nextAvailableBoard() {
    const unused = B.boardNumbers.filter(number => byNumber(number) === -1);
    if (session.index === -1) return unused[0];
    return unused.find(number => number > board().number) ?? unused[0];
  }

  function renderBoardList() {
    const list = byId('board-list');
    list.replaceChildren();
    if (!session.boards.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '暂无牌例';
      list.append(empty);
    }
    let northSouth = 0;
    let scored = 0;
    [...session.boards].sort((a, b) => a.number - b.number).forEach(current => {
      const state = B.auction(current.dealer, current.calls);
      const score = B.duplicateScore(current, state);
      const ready = B.canExport(current);
      const row = document.createElement('div');
      row.className = 'board-row';
      const item = button('', () => selectBoard(current.number), 'open-board');
      const title = document.createElement('span');
      title.className = 'board-row-title';
      const number = document.createElement('strong');
      number.textContent = '第 ' + current.number + ' 副';
      title.append(number);
      if (score !== null) {
        const status = document.createElement('span');
        status.className = 'muted';
        status.textContent = ready ? '可导出' : '牌面待确认';
        title.append(status);
      }
      const result = document.createElement('span');
      result.className = 'board-row-result';
      if (!state.done) result.textContent = '叫牌未完成';
      else if (!state.bid) result.textContent = '四家 Pass';
      else {
        const contract = document.createElement('strong');
        contract.textContent = caption(state.contract);
        if (red(state.bid)) contract.className = 'red';
        const declarer = document.createElement('span');
        declarer.textContent = names[state.declarer] + '家';
        const outcome = document.createElement('span');
        outcome.className = 'result-outcome';
        outcome.textContent = score === null ? '待填结果' : trickOutcome(state.bid, current.tricks);
        result.append(declarer, contract, outcome);
      }
      item.append(title, result);
      if (score !== null) {
        scored++;
        northSouth += score;
        const points = document.createElement('span');
        points.className = 'board-row-points';
        const ns = document.createElement('span');
        ns.textContent = '南北 ' + formatPoints(score);
        const ew = document.createElement('span');
        ew.textContent = '东西 ' + formatPoints(-score);
        points.append(ns, ew);
        item.append(points);
      }
      const remove = button('删除', () => askDelete(current), 'delete-board');
      remove.setAttribute('aria-label', '删除第 ' + current.number + ' 副');
      row.append(item, remove);
      list.append(row);
    });
    byId('list-score').hidden = !session.boards.length;
    byId('list-score-count').textContent = '已计分 ' + scored + '/' + session.boards.length + ' 副';
    byId('total-ns').textContent = formatPoints(northSouth);
    byId('total-ew').textContent = formatPoints(-northSouth);
    byId('new-board').disabled = nextAvailableBoard() === undefined;
    byId('export-all').disabled = !session.boards.some(B.canExport);
  }

  function openList() {
    renderBoardList();
    byId('list-dialog').showModal();
  }

  function changeRoom(code, room) {
    const books = latestBooks();
    const found = books[code] ?? { tables: {}, received: {} };
    const next = { active: code ? { code, room } : null, books: code ? { ...books, [code]: found } : books };
    if (!saveMatches(next)) return;
    session = code ? restoreBook(found.tables[room]) : solo;
    draft = newBoard(1);
    level = 1;

    byId('deal-input').value = '';
    byId('match-transfer').value = '';
    byId('match-status').textContent = '';
    loadPhoto();
    showStage('auction');
    render();
    renderMatch();
  }

  function matchCell(name, board, points) {
    const cell = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = name;
    const result = document.createElement('p');
    const calls = document.createElement('p');
    calls.className = 'muted';
    if (board) {
      const state = B.auction(board.dealer, board.calls);
      if (!state.done) result.textContent = '叫牌未完';
      else if (!state.bid) result.textContent = '四家 Pass';
      else result.textContent = names[state.declarer] + '家 ' + caption(state.contract)
        + (points === null ? '　未录赢墩' : '　' + trickOutcome(state.bid, board.tricks));
      if (points !== null) result.append('　南北 ', formatPoints(points));
      calls.textContent = names[board.dealer] + '家先叫　' + board.calls.map(caption).join(' ');
    } else {
      result.textContent = '无记录';
    }
    cell.append(title, result, calls);
    return cell;
  }

  function renderMatch() {
    const active = matches.active;
    byId('match-active').hidden = !active;
    byId('leave-match').hidden = !active;
    byId('match-codes').replaceChildren(...Object.keys(matches.books).map(code => new Option(code)));
    if (!active) return;
    byId('match-label').textContent = M.rooms[active.room] + '　' + active.code;
    byId('export-room').disabled = !session.boards.length;
    const result = M.compare(activeMatch());
    byId('match-progress').textContent = '已对比 ' + result.played + '/16 副'
      + (result.conflicts ? '　' + result.conflicts + ' 副待核对' : '') + (result.vp ? '' : '　对齐 16 副后计 VP');
    for (const [index, team] of ['a', 'b'].entries()) {
      byId('match-team-' + team).textContent = result[team] + ' IMP'
        + (result.vp ? '　' + result.vp[index].toFixed(2) + ' VP' : '');
    }
    const rows = result.rows.filter(row => row.left || row.right).map(row => {
      const detail = document.createElement('details');
      const title = document.createElement('summary');
      const label = row.imp === null ? row.issue || '待对比'
        : row.imp === 0 ? '0 IMP' : (row.imp > 0 ? 'A 队 ' : 'B 队 ') + Math.abs(row.imp) + ' IMP';
      title.textContent = '第 ' + row.number + ' 副　' + label;
      const grid = document.createElement('div');
      grid.className = 'match-auction';
      grid.append(matchCell('开室', row.left, row.leftScore), matchCell('闭室', row.right, row.rightScore));
      detail.append(title, grid);
      return detail;
    });
    byId('match-boards').replaceChildren(...rows);
  }

  async function copyMatchText(value, field, copied) {
    field.value = value;
    try {
      await navigator.clipboard.writeText(value);
      byId('match-status').textContent = copied;
    } catch {
      field.focus();
      field.select();
      byId('match-status').textContent = '已选中，请复制';
    }
  }

  function importRoom() {
    try {
      const result = M.decode(byId('match-transfer').value);
      const { code, room } = matches.active;
      if (result.code !== code) throw new Error('比赛编号不同');
      if (result.room === room) throw new Error('这是本室成绩，请导入' + M.rooms[M.otherRoom(room)]);
      const books = latestBooks();
      const book = books[code] ?? activeMatch();
      const next = { ...matches, books: { ...books,
        [code]: { ...book, received: { ...book.received, [result.room]: result.boards } } } };
      if (!saveMatches(next)) return;
      byId('match-transfer').value = '';
      renderMatch();
      byId('match-status').textContent = '已导入' + M.rooms[result.room] + ' ' + result.boards.length + ' 副';
    } catch (error) {
      byId('match-status').textContent = error.message;
    }
  }

  function askDelete(current) {
    pendingDelete = current;
    byId('delete-title').textContent = '删除第 ' + current.number + ' 副？';
    byId('delete-dialog').showModal();
  }

  function deleteBoard() {
    const current = pendingDelete;
    if (!current) return;
    pendingDelete = null;
    const active = board();
    const index = session.boards.indexOf(current);
    byId('delete-dialog').close();
    if (index === -1) return;
    const boards = session.boards.filter(item => item !== current);
    const next = { ...session, boards, index: active === current ? Math.min(index, boards.length - 1) : boards.indexOf(active) };
    if (!persist(next)) return;
    session = next;
    const key = photoKey(current);
    selectedVersions.delete(key);
    if (active === current) {

      draft = newBoard(1);
      level = 1;
      byId('deal-input').value = '';
      loadPhoto();
      showStage('auction');
    }
    render();
    renderBoardList();
    say('第 ' + current.number + ' 副已删除');
    updatePhoto(key, null).catch(() => say('牌例已删除，原照片未能清理'));
  }

  document.querySelectorAll('[data-stage]').forEach(item => item.addEventListener('click', () => showStage(item.dataset.stage)));
  document.querySelectorAll('[data-call]').forEach(item => item.addEventListener('click', () => call(item.dataset.call)));
  for (let i = 1; i <= 7; i++) {
    byId('levels').append(button(String(i), () => { level = i; renderAuction(B.auction(board().dealer, board().calls)); }));
  }
  B.denominations.forEach(denomination => {
    byId('bids').append(button(symbols[denomination], () => call(level + denomination), red(denomination) ? 'red' : ''));
  });
  byId('undo').onclick = undo;
  byId('undo-done').onclick = undo;
  for (const number of B.boardNumbers) byId('board-number').add(new Option('第 ' + number + ' 副', number));
  byId('board-number').onchange = event => selectBoard(Number(event.target.value));
  byId('dealer').onchange = event => {
    const current = board();
    current.dealer = event.target.value;
    save();
    render();
    if (current.calls.length) say('已按新发牌人调整叫牌方位');
  };
  byId('vul').onchange = event => {
    board().vul = event.target.value;
    save();
    renderResult(B.auction(board().dealer, board().calls));
  };
  byId('camera').onchange = choosePhoto;
  byId('album').onchange = choosePhoto;
  byId('photo-recognition').hidden = !recognitionUrl;
  byId('detect').onclick = detectPhoto;
  byId('manual-deal').onclick = () => {
    manualEntry = true;
    renderReview();
    byId('review').scrollIntoView({ block: 'nearest' });
  };
  byId('rotate').onclick = () => {
    const current = board();
    const old = current.deal;
    current.deal = Object.fromEntries(B.seats.map((seat, i) => [seat, old[B.seats[(i + 3) % 4]]]));
    current.confirmed = false;
    save();
    render();
  };
  byId('import-deal').onclick = () => {
    const deal = B.parseObservedDeal(byId('deal-input').value);
    if (!deal) { say('Deal 无法读取，请检查格式'); return; }
    ++photoRequest;
    recognition?.abort();

    byId('recognition-message').textContent = '';
    board().deal = deal;
    board().confirmed = false;
    board().finding = '';
    byId('import').open = false;
    byId('deal-input').value = '';
    save();
    render();
  };
  byId('confirm').onclick = () => {
    if (B.validateDeal(board().deal)) { board().confirmed = true; save(); render(); say('牌面已确认'); }
  };
  byId('close-card').onclick = () => byId('card-dialog').close();
  byId('remove-card').onclick = () => changeCard(null);
  byId('open-list').onclick = openList;
  byId('close-list').onclick = () => byId('list-dialog').close();
  byId('cancel-delete').onclick = () => byId('delete-dialog').close();
  byId('confirm-delete').onclick = deleteBoard;
  byId('delete-dialog').onclose = event => {
    if (!event.target.open) pendingDelete = null;
  };
  byId('new-board').onclick = () => selectBoard(nextAvailableBoard());
  byId('export-all').onclick = () => download(session.boards.filter(B.canExport).sort((a, b) => a.number - b.number));
  byId('export').onclick = () => download([board()]);
  byId('open-match').onclick = () => {
    matches = { ...matches, books: latestBooks() };
    byId('match-code').value = matches.active?.code ?? '';
    byId('match-room').value = matches.active?.room ?? 'open';
    byId('match-status').textContent = '';
    renderMatch();
    byId('match-dialog').showModal();
  };
  byId('close-match').onclick = () => byId('match-dialog').close();
  byId('new-match').onclick = () => { byId('match-code').value = M.newCode(); };
  byId('leave-match').onclick = () => {
    changeRoom(null);
    if (!matches.active) byId('match-dialog').close();
  };
  byId('match-form').onsubmit = event => {
    event.preventDefault();
    const code = M.codeFrom(byId('match-code').value);
    if (!M.validCode(code)) {
      byId('match-status').textContent = '请输入或生成 8 位比赛编号';
      return;
    }
    byId('match-code').value = code;
    changeRoom(code, byId('match-room').value);
  };
  byId('copy-match').onclick = () => copyMatchText(matches.active.code, byId('match-code'), '已复制比赛编号');
  byId('export-room').onclick = () => copyMatchText(M.encode(matches.active.code, matches.active.room, session.boards),
    byId('match-transfer'), '已复制本桌成绩');
  byId('import-room').onclick = importRoom;
  showStage('auction', false);
  render();
  loadPhoto();
})();
