import { html } from "htm/preact";
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "preact/hooks";
import { useStore } from "./store.js";
import {
  Icon, todayISO, toISO, fromISO, monthGen, monthNom, relLabel,
  minRangeLabel, minToHHMM, itemsForDate, matchesFilter,
  monthMatrix, weekRangeLabel, weekStart,
  durHuman, doneFeedback, haptic, waveDataUrl,
} from "./lib.js";
import { ConfirmModal, Toasts, TaskEditor, ListForm, AreaForm, MoveTasksModal, AuthForm, SettingsModal, SearchModal } from "./components.js";

const VIEWS = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]];
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
function readView() {
  try { const v = localStorage.getItem("planner.view"); return VIEWS.some(x => x[0] === v) ? v : "day"; }
  catch (e) { return "day"; }
}
// Свёрнутые области панели — помним между сессиями (id → свёрнута).
function readCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem("planner.areasCollapsed") || "[]")); }
  catch (e) { return new Set(); }
}
function writeCollapsed(set) {
  try { localStorage.setItem("planner.areasCollapsed", JSON.stringify([...set])); } catch (e) {}
}

const HOUR_DEFAULT = 80;
const HOUR_MIN = 14;
const HOUR_MAX = 220;
const GUTTER = 56;
const SNAP = 5;
const MIN_DUR = 15;
const NEW_DUR = 5; // длительность новой задачи по умолчанию (мин)
const HOLD_MS = 350;
const MIN_EVENT_PX = 14;
const AD_COLLAPSED = 52; // высота приоткрытой шторки «весь день» по умолчанию (px)
const EDGE_ZONE = 40; // ширина краевой зоны (px), от которой тянется шторка проектов
const snap = m => Math.round(m / SNAP) * SNAP;
function readHourPx() {
  try { const v = +localStorage.getItem("planner.hourPx"); return v >= HOUR_MIN && v <= HOUR_MAX ? v : HOUR_DEFAULT; }
  catch (e) { return HOUR_DEFAULT; }
}
// Пользователь хоть раз менял масштаб вручную (щипок/Ctrl+колесо)? Тогда авто-вписывание
// больше НИКОГДА не трогает масштаб — его меняет только пользователь.
function readZoomed() {
  try { return localStorage.getItem("planner.hourManual") === "1"; } catch (e) { return false; }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// rAF-троттл для setState в жестах: pointermove приходит до 120 раз/с (ProMotion),
// а перерисовывать сетку дня нужно не чаще кадра экрана — применяем только последнее
// значение раз в кадр. Принимает и значение, и функцию-апдейтер. ВАЖНО: перед финальным
// setState в pointerup/cleanup звать .cancel(), иначе отложенный кадр перезатрёт итог.
function rafThrottle(setter) {
  let id = 0, val;
  const run = () => { id = 0; setter(val); };
  const f = (v) => { val = v; if (!id) id = requestAnimationFrame(run); };
  f.cancel = () => { if (id) { cancelAnimationFrame(id); id = 0; } };
  return f;
}

export function App() {
  const store = useStore();
  if (!store.ready) return html`<div class="boot"><div class="boot-spinner"></div></div>`;
  if (!store.user) return html`<${AuthForm} /><${Toasts} />`;
  return html`<${Planner} /><${Toasts} />`;
}

function Planner() {
  const store = useStore();
  const { tasks, taskLists, areas } = store;

  const [date, setDate] = useState(todayISO());
  // Дата, выбранная свайпом, до завершения анимации переезда: полоса недели и
  // вибрация реагируют на неё мгновенно, пока сетка ещё доезжает.
  const [pendingDate, setPendingDate] = useState(null);
  const dateRef = useRef(todayISO());
  dateRef.current = date;
  const [view, setView] = useState(readView());
  const [filter, setFilter] = useState("all");
  // "done"/"trash" — спецразделы (плоские списки): прячут календарь и его жесты.
  const special = filter === "done" || filter === "trash";
  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [edClosing, setEdClosing] = useState(false); // форма закрывается — проигрываем анимацию ухода перед размонтированием
  const [drag, setDrag] = useState(null);
  const [liftDrag, setLiftDrag] = useState(null); // мобильный «подъём» задачи: { key, dx, dy, landing, done } — едет за пальцем
  const liftDragRef = useRef(null);               // актуальное значение для обработчиков свайпа/зума
  const liftedNowRef = useRef(false);             // задача реально поднята (синхронно, для свайпа дня)
  const liftItemRef = useRef(null);               // снимок поднятой задачи — рисуем её плавающей копией
  const liftGeomRef = useRef(null);               // позиция плавающей копии (фикс. координаты вьюпорта)
  const landTimerRef = useRef(null);              // таймер «доезда» задачи на место
  const [dnd, setDnd] = useState(null);
  const [adH, setAdH] = useState(AD_COLLAPSED); // высота шторки «весь день» (px), тянется ручкой
  const adHRef = useRef(AD_COLLAPSED); // актуальная высота шторки для fitMinPx (без устаревания замыкания)
  const setAdHeight = (v) => { adHRef.current = v; setAdH(v); }; // менять высоту шторки только так
  const [openSubs, setOpenSubs] = useState(() => new Set()); // ключи задач с раскрытыми подзадачами в сетке
  const [confetti, setConfetti] = useState(null); // { key, id, bits } — хлопок конфетти при выполнении
  const [fallKey, setFallKey] = useState(null);   // ключ задачи в сетке, чей шарик сейчас падает
  const toggleSubs = (key) => setOpenSubs(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [titleEdit, setTitleEdit] = useState(null); // { key, value } — встроенная правка названия в сетке
  const [subEdit, setSubEdit] = useState(null);     // { key, subId, value } — встроенная правка подзадачи
  const [listModal, setListModal] = useState(null);
  const [delList, setDelList] = useState(null);
  const [areaModal, setAreaModal] = useState(null); // "new" | область — форма области
  const [delArea, setDelArea] = useState(null);      // область к удалению
  const [emptyTrash, setEmptyTrash] = useState(false); // подтверждение очистки корзины
  const [areaCollapsed, setAreaCollapsed] = useState(readCollapsed);
  const toggleArea = (id) => setAreaCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); writeCollapsed(n); return n; });
  // Проекты с раскрытым третьим уровнем (задачи под проектом) в дереве панели.
  const [expandedLists, setExpandedLists] = useState(() => new Set());
  const toggleListExpand = (id) => setExpandedLists(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Перетаскивание задачи в боковом дереве: { id, listId, title, color, w, h, offX,
  // offY, x, y, zone:"tree"|"grid", overIndex, gridMin, dur, landing }. Двигается сама
  // карточка задачи (живая копия под пальцем), соседи расступаются (FLIP).
  const [treeDrag, setTreeDrag] = useState(null);
  const treeDragRef = useRef(null);
  useEffect(() => { treeDragRef.current = treeDrag; }, [treeDrag]);
  const treeRects = useRef(new Map());
  // Перенос ВЫДЕЛЕНИЯ (нескольких задач) в проект/область/входящие/«весь день».
  // { x, y, count, dropList } — dropList: id проекта | "inbox" | "area:<id>" | "__allday__" | null.
  const [selDrag, setSelDrag] = useState(null);
  const [hourPx, setHourPx] = useState(readHourPx());
  // Соседние дни карусели рисуем только во время горизонтального свайпа —
  // иначе зум (масштаб сетки) тормозил бы из-за перерисовки сразу трёх дней.
  const [peek, setPeek] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [swipeId, setSwipeId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [selRange, setSelRange] = useState(null);
  const [asideOpen, setAsideOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches);

  const innerRef = useRef(null);
  const scrollRef = useRef(null);
  const trackRef = useRef(null);
  const keepScrollRef = useRef(false);
  const keepGridTopRef = useRef(null); // позиция сетки относительно вьюпорта — чтобы час под глазами не прыгал при смене дня
  const cancelSnapRef = useRef(null);  // отменить текущую анимацию snap (для смены даты извне)
  const daySwipeStateRef = useRef(null); // управление каруселью дня извне (reset)
  const pendingRecenterRef = useRef(false);
  const commitFinalizeRef = useRef(null);
  const peekTimerRef = useRef(null);
  const weekScrollRef = useRef(null);
  const monthRef = useRef(null);
  const dateInputRef = useRef(null);
  const hourPxRef = useRef(hourPx);
  const zoomedRef = useRef(readZoomed()); // масштаб зафиксирован вручную — авто-вписывание отключено
  const markZoomed = () => { if (!zoomedRef.current) { zoomedRef.current = true; try { localStorage.setItem("planner.hourManual", "1"); } catch (e) {} } };
  const zoomAnchor = useRef(null);
  const zoomFocus = useRef(null);   // точка под пальцами при зуме (фиксируем её)
  const zoomingRef = useRef(false); // идёт изменение масштаба
  const swipingRef = useRef(false); // идёт горизонтальный свайп дней
  const createActiveRef = useRef(false); // идёт создание новой задачи (растягивание в сетке) — карусель дня не вмешивается
  const kbPrimerRef = useRef(null);   // скрытое поле: поднять клавиатуру синхронно в жесте, затем фокус уедет в форму
  const dndGeomRef = useRef(null);    // ширина/левый край сетки для плавающей капсулы при переносе из «весь день»
  const primeKeyboard = () => { try { kbPrimerRef.current && kbPrimerRef.current.focus({ preventScroll: true }); } catch (e) { try { kbPrimerRef.current.focus(); } catch (e2) {} } };
  const projRef = useRef(null);
  const asideRef = useRef(null);
  const edBackRef = useRef(null);  // оверлей формы — на мобильном позиционируем по блоку задачи
  const contentRef = useRef(null); // слой «День» — едет вправо, открывая панель проектов под ним
  const swipedRef = useRef(false);
  const trayClickGuard = useRef(false);
  const adGridRef = useRef(null);   // контейнер зоны «весь день»
  const adRects = useRef(new Map()); // позиции карточек для FLIP-анимации
  const lastTap = useRef({ key: null, t: 0 });

  useEffect(() => {
    if (!projOpen) { setSwipeId(null); return; }
    const onDown = (e) => { if (projRef.current && !projRef.current.contains(e.target)) setProjOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [projOpen]);

  useEffect(() => { try { localStorage.setItem("planner.view", view); } catch (e) {} }, [view]);
  useEffect(() => () => clearTimeout(peekTimerRef.current), []); // не оставлять таймер при размонтировании
  // При размонтировании Planner глушим возможные «висящие» таймеры жестов (доезд
  // поднятой задачи / автолистание соседних дней) — чтобы они не дёрнули setState
  // на уже снятом компоненте.
  useEffect(() => () => { clearTimeout(landTimerRef.current); clearTimeout(peekTimerRef.current); }, []);

  // Отмена/возврат: Cmd/Ctrl+Z — отменить, Cmd/Ctrl+Shift+Z — повторить.
  // (кроме случаев ввода текста в полях).
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.code !== "KeyZ") return;
      const t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Удаление выделенных задач клавишами Delete/Backspace.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      if (selected.size === 0) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // Выделение относится к конкретному дню — сбрасываем при смене дня/вида.
  useEffect(() => {
    if (liftDragRef.current || createActiveRef.current) return; // идёт перенос/создание на другой день — не сбрасываем выделение/шторку
    setSelected(new Set()); setSelRange(null); setAdHeight(AD_COLLAPSED);
  }, [date, view, filter]);

  // Снять выделение кликом в любое место вне капсулы (даже по названию, заметке,
  // пустой области). Слушаем в фазе захвата, чтобы ловить и события, у которых
  // дочерние обработчики останавливают всплытие (название, подзадачи).
  useEffect(() => {
    if (selected.size === 0) return;
    const onDown = (e) => { const t = e.target; if (!(t && t.closest && (t.closest(".tl-event") || t.closest(".allday-item")))) setSelected(new Set()); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selected]);
  useEffect(() => { hourPxRef.current = hourPx; }, [hourPx]);
  // Запись масштаба в localStorage — с задержкой: при щипке/ресайзе шторки hourPx
  // меняется десятки раз в секунду, а синхронный setItem на каждый шаг тормозит жест.
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem("planner.hourPx", String(hourPx)); } catch (e) {} }, 300);
    return () => clearTimeout(t);
  }, [hourPx]);
  useEffect(() => { liftDragRef.current = liftDrag; }, [liftDrag]); // обработчикам свайпа/зума нужно актуальное «поднята ли задача»
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);

  // Масштаб часов = так, чтобы вся прокручиваемая лента влезла в экран точь-в-точь
  // (scrollHeight == clientHeight): ни прокрутки, ни пустоты. «Лишнее» помимо самих
  // часов (зона «весь день», ручка, отступы, бордюры, суб-пиксели, и что бы там ни
  // было СВЕРХУ И СНИЗУ) меряем напрямую = высота ленты − высота сетки часов. Что бы
  // ни пряталось в вёрстке — оно попадёт в extra, и расчёт будет точным.
  function fitMinPx() {
    const el = scrollRef.current, grid = innerRef.current, track = trackRef.current;
    if (!el || !grid) return HOUR_MIN;
    const cs = getComputedStyle(el);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const extra = track ? Math.max(0, track.offsetHeight - grid.offsetHeight) : 0;
    const h = el.clientHeight - padT - padB - extra;
    return h > 0 ? Math.max(HOUR_MIN, h / 24) : HOUR_MIN;
  }

  // Запоминаем точку под курсором перед зумом, чтобы после смены масштаба
  // оставить это же время дня под курсором (как в Apple Календаре).
  function computeAnchor(clientY) {
    const cont = scrollRef.current, grid = innerRef.current;
    if (!cont || !grid) return null;
    const yInContainer = clientY - cont.getBoundingClientRect().top;
    const timeMin = (clientY - grid.getBoundingClientRect().top) / hourPxRef.current * 60;
    return { timeMin, yInContainer };
  }
  function zoomAnchorAt(clientY) { zoomAnchor.current = computeAnchor(clientY); }
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const cont = scrollRef.current, grid = innerRef.current;
    if (!a || !cont || !grid) return;
    zoomAnchor.current = null;
    const gridOffset = (grid.getBoundingClientRect().top - cont.getBoundingClientRect().top) + cont.scrollTop;
    cont.scrollTop = gridOffset + (a.timeMin / 60) * hourPx - a.yInContainer;
  }, [hourPx]);

  // «Дотягиваем» масштаб так, чтобы 24 часа влезали в экран — только если он слишком
  // отдалён (prev < fit). НИКОГДА не сжимаем (увеличенный вручную не трогаем). Раз
  // Вписываем день ТОЧНО под текущую шторку: hp = ровно остаток / 24. На входе в день
  // и при смене дня (шторка сброшена в AD_COLLAPSED) это одно и то же значение → масштаб
  // стабилен при свайпе. fitMinPx учитывает adH, поэтому вписывание всегда без пустоты.
  useEffect(() => {
    if (view !== "day") return;
    // Масштаб подбираем автоматически ТОЛЬКО пока пользователь сам его не менял.
    // После ручного щипка — масштаб его, авто-вписывание молчит (в т.ч. при смене дня,
    // повороте, открытии клавиатуры). Зависимость без date: смена дня масштаб не трогает.
    // И НИКОГДА не пересчитываем во время переноса/создания — иначе сетка перескалируется
    // под пальцем (на iOS адресная строка дёргает размер) и задача «улетает» не туда.
    const fitNow = () => { if (zoomedRef.current || liftDragRef.current || createActiveRef.current) return; setHourPx(fitMinPx()); };
    let r1 = 0, r2 = 0;
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(fitNow); });
    window.addEventListener("resize", fitNow);
    window.addEventListener("orientationchange", fitNow);
    return () => {
      cancelAnimationFrame(r1); cancelAnimationFrame(r2);
      window.removeEventListener("resize", fitNow);
      window.removeEventListener("orientationchange", fitNow);
    };
  }, [view, special]);

  // Надёжное вписывание: ResizeObserver ловит МОМЕНТ, когда высота контейнера сетки
  // окончательно устаканилась (на iOS это бывает позже первых кадров), и дотягивает
  // масштаб до fit. Раньше двойного rAF не всегда хватало → hp оставался меньше fit
  // → пустота снизу. Тут — гарантированно после фактического изменения размера.
  useEffect(() => {
    if (view !== "day" || typeof ResizeObserver === "undefined") return;
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (zoomedRef.current || liftDragRef.current || createActiveRef.current) return; setHourPx(fitMinPx()); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, special]);

  // Сетка дня: горизонтальный свайп между днями обрабатывает САМ браузер через
  // CSS scroll-snap — лента из 3 панелей (вчера/сегодня/завтра) с обязательным
  // снапом по горизонтали. Браузер знает, когда пальцы на тачпаде, а когда нет,
  // даёт нативную инерцию и плавный снап. Мы только: (а) держим зум по Ctrl+
  // колесо и Safari-pinch, (б) слушаем когда снап завершился и обновляем дату.
  useEffect(() => {
    const el = scrollRef.current;
    if (view !== "day" || !el) return;
    let clsTimer = null;
    const markZooming = () => {
      el.classList.add("zooming");
      clearTimeout(clsTimer);
      clsTimer = setTimeout(() => el.classList.remove("zooming"), 180);
    };
    const onWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        markZooming(); markZoomed();
        zoomAnchorAt(e.clientY);
        setHourPx(prev => clamp(Math.round(prev * Math.exp(-e.deltaY * 0.01)), fitMinPx(), HOUR_MAX));
        return;
      }
      // Любое другое колёсико (вертикальное/горизонтальное) — браузер сам.
    };
    let base = hourPxRef.current;
    const onGStart = (e) => {
      if (liftDragRef.current || createActiveRef.current) return; // идёт перенос/создание — масштаб не трогаем
      e.preventDefault();
      zoomingRef.current = true;
      base = hourPxRef.current;
    };
    const onGChange = (e) => {
      e.preventDefault();
      if (!zoomingRef.current) return;
      markZooming(); markZoomed();
      const r = el.getBoundingClientRect();
      zoomAnchor.current = zoomFocus.current || computeAnchor(r.top + el.clientHeight / 2);
      setHourPx(clamp(Math.round(base * e.scale), fitMinPx(), HOUR_MAX));
    };
    const onGEnd = () => { zoomingRef.current = false; zoomFocus.current = null; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGStart);
    el.addEventListener("gesturechange", onGChange);
    el.addEventListener("gestureend", onGEnd);
    return () => {
      clearTimeout(clsTimer);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGStart);
      el.removeEventListener("gesturechange", onGChange);
      el.removeEventListener("gestureend", onGEnd);
    };
  }, [view, special]);

  // Свайп дней — карусель на CSS transform (ручное управление, без нативного скролла
  // по горизонтали). Браузер не вмешивается → можем дать живой драг, низкий порог
  // коммита и мгновенное прерывание новым свайпом.
  useEffect(() => {
    const el = scrollRef.current, track = trackRef.current;
    if (view !== "day" || !el || !track) return;
    let dx = 0;             // текущее смещение ленты в пикселях (минус = ушли влево, видно следующий день)
    let lastInputT = 0;     // время последнего пользовательского события
    let endTimer = null;    // таймер «жест с инерцией закончился»
    let animFrame = null;
    let animating = false;
    const apply = () => { track.style.transition = "none"; track.style.transform = `translateX(calc(-100% + ${dx}px))`; };
    const cancelAnim = () => { if (animFrame) cancelAnimationFrame(animFrame); animFrame = null; animating = false; };
    const animateTo = (target, duration) => {
      cancelAnim();
      if (Math.abs(target - dx) < 0.5) { dx = target; apply(); finishCommit(target); schedulePeekOff(); return; }
      // Длительность зависит от остатка пути: полноэкранный доезд плавный (как
      // переход недели/месяца), короткая дотяжка — быстрая. Жёсткие 320мс на любой
      // путь делали доезд от низкого порога слишком резким (большой путь за то же время).
      const w = el.clientWidth || 1;
      if (duration == null) duration = clamp(Math.round(280 + (Math.abs(target - dx) / w) * 180), 280, 460);
      const start = dx, diff = target - dx, t0 = performance.now();
      animating = true;
      const step = (now) => {
        if (!animating) return;
        const t = Math.min((now - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
        dx = start + diff * ease;
        apply();
        if (t < 1) animFrame = requestAnimationFrame(step);
        else { animating = false; animFrame = null; finishCommit(target); schedulePeekOff(); }
      };
      animFrame = requestAnimationFrame(step);
    };
    const finishCommit = (target) => {
      if (Math.abs(target) < 1) return; // вернулись в центр — день не меняем
      const dir = target < 0 ? 1 : -1;
      keepScrollRef.current = true;
      const d = fromISO(dateRef.current); d.setDate(d.getDate() + dir);
      dateRef.current = toISO(d);
      setDate(dateRef.current);
    };
    const triggerSnap = () => {
      const w = el.clientWidth;
      if (!w) return;
      const threshold = w * 0.12; // низкий порог — даже короткий свайп листает
      let target = 0;
      if (dx < -threshold) target = -w;
      else if (dx > threshold) target = w;
      if (target !== 0) haptic(); // лёгкая вибрация в начале листания (как в неделе/месяце)
      animateTo(target);
    };
    daySwipeStateRef.current = {
      reset: () => { cancelAnim(); dx = 0; track.style.transition = "none"; track.style.transform = "translateX(-100%)"; },
      getDx: () => dx,
      setDx: (v) => { cancelAnim(); const w = el.clientWidth; dx = Math.max(-w, Math.min(w, v)); apply(); },
      snap: () => { clearTimeout(endTimer); triggerSnap(); },
      cancel: () => { cancelAnim(); clearTimeout(endTimer); },
    };
    const onWheel = (e) => {
      if (e.ctrlKey) return; // зум обрабатывает другой effect
      // Горизонтальный жест ведёт нас, вертикальный — нативный скролл
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      clearTimeout(peekTimerRef.current); setPeek(true); // соседние дни — только на время жеста
      lastInputT = performance.now();
      // Любое новое событие колеса прерывает идущую доводку и продолжает тянуть ленту
      // с текущего места — иначе доводка-анимация дерётся с жестом (зависание + рывок).
      if (animating) cancelAnim();
      const w = el.clientWidth;
      dx = Math.max(-w, Math.min(w, dx - e.deltaX));
      apply();
      clearTimeout(endTimer);
      // У трекпада нет события «отпустил пальцы» — считаем, что жест закончился, когда
      // события колеса прекратились на ~160мс (сюда же попадает затухание инерции).
      // Пауза заметно больше прежних 80мс, чтобы лента не уезжала при замедлении свайпа.
      endTimer = setTimeout(triggerSnap, 160);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      daySwipeStateRef.current = null;
      cancelAnim();
      clearTimeout(endTimer);
      el.removeEventListener("wheel", onWheel);
    };
  }, [view, special]);

  // После смены даты (от свайпа или клика по дню) сбрасываем смещение карусели
  // в 0: новая «текущая» панель уже в центре, dx должен быть 0.
  useLayoutEffect(() => {
    if (view !== "day") return;
    daySwipeStateRef.current?.reset();
  }, [date, view]);

  // Свайп тачпадом (горизонтальное колёсико) в режимах неделя/месяц — «живая лента»
  // за пальцем, как у дня: тянем карусель за жестом, на отпускании — доезд или
  // возврат. Ось защёлкивается. Логика повторяет дневное колесо (см. ниже).
  useEffect(() => {
    if (view !== "week" && view !== "month") return;
    const el = view === "week" ? weekScrollRef.current : monthRef.current;
    if (!el) return;
    let phase = "idle", dragDx = 0, dragVel = 0, gestureAxis = null, decideTimer = null, resetTimer = null;
    let lastAbs = 0, decayCount = 0, peakAbs = 0, lastAbsMin = 1e9;
    let lastCommitT = 0;
    const tryCommit = (dir) => {
      const now = Date.now();
      if (now - lastCommitT < 320) return false;
      lastCommitT = now;
      daySwipeCommit(dir);
      return true;
    };
    const widthOf = () => el.getBoundingClientRect().width || window.innerWidth;
    const decideSwipe = () => {
      if (phase !== "drag") return;
      phase = "done";
      const W = widthOf();
      const dir = dragDx < 0 ? 1 : -1;
      const veloMatch = (dragVel > 0) === (dragDx > 0);
      const enough = (Math.abs(dragDx) > 14 && veloMatch) || Math.abs(dragDx) > W * 0.25;
      if (enough) { if (!tryCommit(dir)) daySwipeSnapBack(); }
      else daySwipeSnapBack();
    };
    const idleSnapBack = () => { if (phase === "drag") { phase = "done"; daySwipeSnapBack(); } };
    const resetSwipe = () => { phase = "idle"; gestureAxis = null; dragDx = 0; dragVel = 0; lastAbs = 0; decayCount = 0; peakAbs = 0; lastAbsMin = 1e9; };
    const onWheel = (e) => {
      if (e.ctrlKey) return;
      if (gestureAxis === null) gestureAxis = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? "h" : "v";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(resetSwipe, 350);
      if (gestureAxis !== "h") return;
      e.preventDefault();
      const abs = Math.abs(e.deltaX);
      if (phase === "done") {
        if (lastAbsMin < 4 && abs > lastAbsMin + 5 && abs > 10) {
          resetSwipe();
          // продолжаем выполнение — попадём в ветку phase === "idle" ниже
        } else {
          if (abs > peakAbs) peakAbs = abs;
          lastAbsMin = Math.min(lastAbsMin, abs);
          return;
        }
      }
      const track = trackRef.current;
      if (!track) return;
      const W = widthOf();
      if (phase === "idle") {
        if (commitFinalizeRef.current) commitFinalizeRef.current();
        clearTimeout(peekTimerRef.current); setPeek(true); swipingRef.current = true;
        phase = "drag"; dragDx = 0; dragVel = 0; lastAbs = 0; decayCount = 0; peakAbs = abs; lastAbsMin = 1e9;
      }
      if (abs > peakAbs) peakAbs = abs;
      const dxw = -e.deltaX;
      dragDx = clamp(dragDx + dxw, -W, W);
      dragVel = dragVel * 0.5 + dxw * 0.5;
      track.style.transition = "none";
      track.style.transform = `translateX(calc(-100% + ${dragDx}px))`;
      if (abs < lastAbs - 0.5) decayCount++;
      else if (abs > lastAbs + 1) decayCount = 0;
      lastAbs = abs;
      const liftDetected = abs < 1;
      clearTimeout(decideTimer);
      if (liftDetected) { lastAbsMin = peakAbs; decideSwipe(); }
      else decideTimer = setTimeout(idleSnapBack, 5000);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { clearTimeout(decideTimer); clearTimeout(resetTimer); el.removeEventListener("wheel", onWheel); };
  }, [view, special]);

  const lists = useMemo(() => [...taskLists].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [taskLists]);
  const listById = useMemo(() => Object.fromEntries(lists.map(l => [l.id, l])), [lists]);
  const areasSorted = useMemo(() => [...areas].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [areas]);
  const areaById = useMemo(() => Object.fromEntries(areasSorted.map(a => [a.id, a])), [areasSorted]);
  const areaOfList = (lid) => listById[lid]?.area_id || null;
  const matches = (i) => matchesFilter(i, filter, areaOfList);

  // Сетка дня (день/неделя/месяц) ВСЕГДА показывает все задачи — выбор папки в
  // боковой панели на сетку не влияет.
  const dayItems = useMemo(() => itemsForDate(tasks, date), [tasks, date, taskLists]);
  const timed = useMemo(() => dayItems.filter(i => i.start_min !== null && i.start_min !== undefined), [dayItems]);
  // Порядок задач «весь день» задаётся sort_order строки; на drag перезаписываем его.
  const sortOrderById = useMemo(() => {
    const m = new Map();
    for (const t of tasks) m.set(t.id, t.sort_order ?? 0);
    return m;
  }, [tasks]);
  const rowIdOf = (i) => (i.kind === "occurrence" ? i.templateId : i.id);
  // Задачи этого дня без времени — показываем в зоне «весь день» над сеткой.
  // Выполненные остаются здесь же (приглушённые, в конце списка) — чтобы было
  // видно, что сделано; они числятся в «Завершено» и на другие дни не переносятся.
  const allDay = useMemo(() => dayItems
    .filter(i => (i.start_min === null || i.start_min === undefined))
    .sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1)
      || ((sortOrderById.get(rowIdOf(a)) ?? 0) - (sortOrderById.get(rowIdOf(b)) ?? 0))
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)), [dayItems, sortOrderById]);
  const allDayIds = useMemo(() => new Set(allDay.map(i => (i.kind === "occurrence" ? i.templateId : i.id))), [allDay]);
  // id задач, уже стоящих блоком в сетке текущего дня (одиночные — по id,
  // повторяющиеся — по id шаблона). Их не показываем в боковой панели.
  const gridIds = useMemo(() => new Set(timed.map(i => (i.kind === "occurrence" ? i.templateId : i.id))), [timed]);
  // Боковая панель: задачи проекта, которых нет в сетке этого дня (без времени,
  // другого дня или вовсе без даты). Без дублей повторений (только шаблоны).
  const projTasks = useMemo(() => tasks
    .filter(t => !t.recurrence_parent && !t.deleted_at && matches(t))
    .sort((a, b) => (a.done - b.done)
      || ((a.date || "9999-99") < (b.date || "9999-99") ? -1 : (a.date || "9999-99") > (b.date || "9999-99") ? 1 : 0)
      || ((a.start_min ?? 1e9) - (b.start_min ?? 1e9))
      || ((a.sort_order || 0) - (b.sort_order || 0))), [tasks, filter, taskLists]);
  // Спецразделы: завершённые и корзина — плоские списки во весь контент.
  const doneTasks = useMemo(() => tasks
    .filter(t => t.done && !t.deleted_at && !t.recurrence_parent && !t.recurrence)
    .sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")), [tasks]);
  const trashTasks = useMemo(() => tasks
    .filter(t => t.deleted_at)
    .sort((a, b) => (b.deleted_at || "").localeCompare(a.deleted_at || "")), [tasks]);
  const trayTasks = useMemo(() => projTasks.filter(t => !gridIds.has(t.id) && !allDayIds.has(t.id)), [projTasks, gridIds, allDayIds]);

  const week = useMemo(() => {
    const base = fromISO(pendingDate || date);
    const off = (base.getDay() + 6) % 7;
    const mon = new Date(base); mon.setDate(base.getDate() - off);
    const WD = WD_SHORT;
    return Array.from({ length: 7 }, (_, k) => {
      const dd = new Date(mon); dd.setDate(mon.getDate() + k);
      return { iso: toISO(dd), day: dd.getDate(), short: WD[k] };
    });
  }, [date, pendingDate]);

  const monthWeeks = useMemo(() => view === "month" ? monthMatrix(date) : null, [view, date]);
  const monthItems = useMemo(() => {
    if (view !== "month" || !monthWeeks) return null;
    const map = {};
    for (const wk of monthWeeks) for (const c of wk) {
      map[c.iso] = itemsForDate(tasks, c.iso)
        .sort((a, b) => {
          const at = a.start_min ?? 1e9, bt = b.start_min ?? 1e9;
          return at - bt;
        });
    }
    return map;
  }, [view, monthWeeks, tasks, taskLists]);

  const weekDays = useMemo(() => {
    if (view !== "week") return null;
    const mon = weekStart(date);
    const WD = WD_SHORT;
    return Array.from({ length: 7 }, (_, k) => {
      const dd = new Date(mon); dd.setDate(mon.getDate() + k);
      const iso = toISO(dd);
      const items = itemsForDate(tasks, iso);
      const t = items.filter(i => i.start_min !== null && i.start_min !== undefined);
      return {
        iso, day: dd.getDate(), short: WD[k], isToday: iso === todayISO(),
        timed: layoutColumns(t, null),
        untimed: items.filter(i => i.start_min === null || i.start_min === undefined),
      };
    });
  }, [view, date, tasks, taskLists]);

  useEffect(() => {
    // Свайп дня — позицию сетки восстанавливает useLayoutEffect ниже (до отрисовки).
    if (keepScrollRef.current) { keepScrollRef.current = false; return; }
    const el = view === "day" ? scrollRef.current : view === "week" ? weekScrollRef.current : null;
    if (!el) return;
    const now = new Date();
    const target = view === "day" && date === todayISO() ? now.getHours() * 60 + now.getMinutes() : 8 * 60;
    // Ставим позицию после раскладки (двойной rAF) — иначе на старте iOS высота
    // ещё не финальная и прокрутка встаёт криво (пустые места сверху/снизу).
    const apply = () => {
      let off = 0; // высота зоны «весь день» + отступ сетки — чтобы «сейчас» вставало точно
      if (view === "day" && innerRef.current) off = (innerRef.current.getBoundingClientRect().top - el.getBoundingClientRect().top) + el.scrollTop;
      el.scrollTop = Math.max(0, off + (target / 60) * hourPx - 120);
    };
    apply();
    const id = requestAnimationFrame(() => requestAnimationFrame(apply));
    return () => cancelAnimationFrame(id);
  }, [view, date, special]);

  // После переключения дня свайпом лента уехала к соседней панели — мгновенно
  // (до отрисовки) возвращаем её в центр, где уже отрисован новый текущий день.
  useLayoutEffect(() => {
    if (!pendingRecenterRef.current) return;
    pendingRecenterRef.current = false;
    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = "translateX(-100%)";
      void track.offsetWidth;
      track.style.transition = "";
      track.style.transform = "";
    }
    // До отрисовки возвращаем сетку на ту же позицию относительно вьюпорта — чтобы
    // другая высота зоны «весь день» у нового дня не сдвинула видимый диапазон часов.
    const cont = scrollRef.current, grid = innerRef.current, want = keepGridTopRef.current;
    keepGridTopRef.current = null;
    if (cont && grid && want != null) {
      const cur = grid.getBoundingClientRect().top - cont.getBoundingClientRect().top;
      cont.scrollTop += (cur - want);
    }
    schedulePeekOff(); // соседние дни прячем с задержкой (для листания подряд)
  }, [date]);

  const yToMin = (clientY) => ((clientY - innerRef.current.getBoundingClientRect().top) / hourPx) * 60;
  const colorOf = (i) => i.color || listById[i.list_id]?.color || "var(--inbox)";

  // FLIP: карточки «весь день» плавно доезжают на новые места при перестановке,
  // добавлении и удалении. До перерисовки помним позиции, после — анимируем разницу.
  useLayoutEffect(() => {
    const grid = adGridRef.current;
    if (!grid) { adRects.current.clear(); return; }
    const cells = grid.querySelectorAll("[data-adkey]");
    const seen = new Set();
    cells.forEach(cell => {
      const key = cell.dataset.adkey;
      seen.add(key);
      if (cell.classList.contains("lifted")) return; // плавающую карточку не двигаем
      const r = cell.getBoundingClientRect();
      const prev = adRects.current.get(key);
      if (prev) {
        const dx = prev.left - r.left, dy = prev.top - r.top;
        if (dx || dy) {
          cell.style.transition = "none";
          cell.style.transform = `translate(${dx}px, ${dy}px)`;
          requestAnimationFrame(() => {
            cell.style.transition = "transform .34s cubic-bezier(.2,.9,.25,1)";
            cell.style.transform = "";
          });
        }
      }
      adRects.current.set(key, r);
    });
    for (const k of [...adRects.current.keys()]) if (!seen.has(k)) adRects.current.delete(k);
  }, [allDay.map(i => i.key).join(",") + "|" + (treeDrag && treeDrag.zone === "allday" && treeDrag.adIndex != null ? treeDrag.key + ":" + treeDrag.adIndex : ""), view]);
  const showErr = (e) => store.pushToast(e.message || "Ошибка сохранения", "error");
  // Цель правки: у повтора — шаблон, иначе сама задача.
  const taskTargetId = (i) => i.recurring ? i.templateId : i.id;
  // Фокус + каретка в конец при появлении поля встроенной правки.
  const focusEnd = (el) => { if (el && !el._fe) { el._fe = true; el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} } };
  // Смещение каретки по точке клика (чтобы курсор встал туда, куда кликнули).
  function caretOffsetFromClick(e) {
    try {
      if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); return r ? r.startOffset : null; }
      if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); return p ? p.offset : null; }
    } catch (_) {}
    return null;
  }
  function startTitleEdit(i, caret) { setSubEdit(null); setTitleEdit({ key: i.key, value: i.title || "", caret }); }
  function commitTitle(i) {
    const e = titleEdit; if (!e || e.key !== i.key) return;
    const v = e.value.trim(); setTitleEdit(null);
    if (v && v !== (i.title || "")) store.actions.tasks.update(taskTargetId(i), { title: v }).catch(showErr);
  }
  function startSubEdit(i, s) { setTitleEdit(null); setSubEdit({ key: i.key, subId: s.id, value: s.title || "" }); }
  function commitSubEdit(i) {
    const e = subEdit; if (!e || e.key !== i.key) return;
    const v = e.value.trim(); const sid = e.subId; setSubEdit(null);
    if (v) store.actions.tasks.updateSub(taskTargetId(i), sid, { title: v }).catch(showErr);
  }

  // Свободная рамка-выделение (как в Finder): тянем прямоугольник в любую сторону —
  // выделяются и блоки сетки дня, и задачи «весь день», которых рамка касается.
  // Координаты — экранные (вьюпорт), пересечение по реальным позициям (DOM).
  function startRangeSelect(e) {
    e.preventDefault();
    const scope = scrollRef.current || document;
    const sx = e.clientX, sy = e.clientY;
    const base = new Set(selected);
    const apply = (cx, cy) => {
      const rx0 = Math.min(sx, cx), ry0 = Math.min(sy, cy), rx1 = Math.max(sx, cx), ry1 = Math.max(sy, cy);
      const n = new Set(base);
      scope.querySelectorAll(".tl-event[data-key], .allday-item[data-adkey]").forEach(el => {
        const k = el.dataset.key || el.dataset.adkey;
        if (!k || k === "__adph") return;
        const r = el.getBoundingClientRect();
        if (r.left < rx1 && r.right > rx0 && r.top < ry1 && r.bottom > ry0) n.add(k);
      });
      setSelected(n);
      setSelRange({ x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 });
    };
    const move = ev => { ev.preventDefault(); apply(ev.clientX, ev.clientY); };
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); setSelRange(null); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    apply(sx, sy);
  }

  // Создание задачи прямо в сетке (как в Apple Календаре). Долгое нажатие → задача
  // фиксируется в этом времени (5 мин). Не отпуская, тянешь вниз — растёт к концу, вверх —
  // к началу (конец = точка нажатия). Отпустил — открывается форма с этой длительностью.
  function onGridPointerDown(e) {
    if (e.button !== 0 && e.pointerType !== "touch") return;
    if (liftDragRef.current || createActiveRef.current) return; // идёт перенос/создание — новый жест не начинаем
    if (e.shiftKey) { startRangeSelect(e); return; }
    const touch = e.pointerType === "touch";
    const el = e.currentTarget, pid = e.pointerId;
    const anchor = clamp(snap(yToMin(e.clientY)), 0, 1440); // время точки нажатия — «якорь»
    let cur = anchor, active = false, hold = null, dragged = false;
    const beginTouch = () => {
      active = true;
      createActiveRef.current = true;
      setSelected(new Set());
      try { el.setPointerCapture && el.setPointerCapture(pid); } catch (err) {}
      // Непассивный слушатель добавляем только после активации — чтобы обычная
      // вертикальная прокрутка оставалась быстрой (без ожидания JS).
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      setDrag({ type: "create", start: clamp(anchor, 0, 1440 - NEW_DUR), dur: NEW_DUR });
      haptic();
    };
    const beginMouse = () => { active = true; setSelected(new Set()); setDrag({ type: "create", start: anchor, dur: 0 }); };
    // Тянем от якоря: вниз — растёт к концу, вверх — растёт к началу (конец = якорь).
    const apply = (ev) => {
      cur = clamp(snap(yToMin(ev.clientY)), 0, 1440);
      const start = Math.min(anchor, cur), end = Math.max(anchor, cur);
      if (end - start >= SNAP) dragged = true;
      setDrag({ type: "create", start, dur: Math.max(SNAP, end - start) });
    };
    const move = ev => {
      if (ev.pointerId !== pid) return; // основной палец; второй (листание дня) — в onTouchMove
      if (!active) {
        const far = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY);
        if (touch) { if (far > 14) finish(false); return; } // двинул до долгого нажатия = прокрутка
        if (far > 6) beginMouse(); else return;
      }
      ev.preventDefault();
      apply(ev);
    };
    const onTouchMove = ev => { if (active) ev.preventDefault(); }; // глушим прокрутку во время создания
    const finish = (commit) => {
      clearTimeout(hold);
      createActiveRef.current = false;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("touchmove", onTouchMove, { passive: false });
      setDrag(null);
      if (!active) { if (commit) setSelected(new Set()); return; }
      if (!commit) return;
      // Без перетаскивания — 5 мин от якоря; с перетаскиванием — выбранный интервал.
      const start = dragged ? Math.min(anchor, cur) : anchor;
      let dur = dragged ? Math.abs(cur - anchor) : NEW_DUR;
      if (dur < SNAP) dur = NEW_DUR;
      // Клавиатуру на iOS поднимаем синхронно в pointerup скрытым полем; фокус уедет на название.
      if (touch) primeKeyboard();
      setCreating({ date: dateRef.current, start_min: clamp(start, 0, 1440 - dur), duration_min: dur,
        ...newTaskTarget() });
    };
    const up = (ev) => { if (ev.pointerId === pid) finish(true); };
    const cancel = (ev) => { if (ev.pointerId === pid) finish(false); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    if (touch) hold = setTimeout(beginTouch, HOLD_MS);
  }

  function dndZoneAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest(".allday")) return "allday";
    if (el.closest(".planner-grid-scroll")) return "grid";
    if (el.closest(".planner-aside")) return "tray";
    return null;
  }

  // Одиночный тап — выделить; двойной — открыть карточку; Shift+тап — добавить
  // или убрать из выделения.
  function handleTap(item, shift) {
    if (shift) {
      setSelected(prev => { const n = new Set(prev); n.has(item.key) ? n.delete(item.key) : n.add(item.key); return n; });
      return;
    }
    const now = Date.now();
    if (lastTap.current.key === item.key && now - lastTap.current.t < 320) {
      lastTap.current = { key: null, t: 0 };
      openPreview(item);
      return;
    }
    lastTap.current = { key: item.key, t: now };
    setSelected(new Set([item.key]));
  }

  function deleteSelected() {
    // Выделение охватывает и сетку дня, и зону «весь день».
    const items = [...dayTl, ...allDay].filter(i => selected.has(i.key));
    if (items.length === 0) return;
    store.batch("удаление", () => {
      for (const i of items) {
        if (i.kind === "concrete") store.actions.tasks.remove(i.id).catch(showErr);
        else store.actions.tasks.removeOccurrence(i).catch(showErr);
      }
    });
    setSelected(new Set());
    store.pushToast(items.length > 1 ? `Удалено: ${items.length}` : "Задача удалена", "success");
  }

  // Выделенные задачи (сетка + «весь день») как список id (только конкретные строки).
  function selectedTaskIds() {
    const items = [...dayTl, ...allDay].filter(i => selected.has(i.key) && i.kind === "concrete" && i.id);
    return [...new Set(items.map(i => i.id))];
  }
  // Что под курсором в боковой панели: id проекта | "inbox" | "area:<id>" | null.
  function sectionAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const row = el.closest("[data-droplist]");
    if (row) return row.dataset.droplist;
    const cont = el.closest("[data-listtasks]");
    if (cont) return cont.dataset.listtasks;
    return null;
  }
  // Перенести список задач в раздел (проект/область/входящие) — снимаем дату/время.
  function moveTasksToSection(ids, dropList) {
    if (!ids.length) return;
    const clear = { date: null, start_min: null, duration_min: null };
    let patch;
    if (dropList === "inbox") patch = { list_id: null, area_id: null, ...clear };
    else if (dropList.indexOf("area:") === 0) patch = { area_id: dropList.slice(5), list_id: null, ...clear };
    else patch = { list_id: dropList, area_id: null, ...clear };
    store.batch("перенос", () => ids.forEach(id => store.actions.tasks.update(id, patch).catch(showErr)));
    if (dropList.indexOf("area:") === 0) setAreaCollapsed(prev => { const n = new Set(prev); n.delete(dropList.slice(5)); writeCollapsed(n); return n; });
    else setExpandedLists(prev => { const n = new Set(prev); n.add(dropList); return n; });
    setSelected(new Set());
    store.pushToast(ids.length > 1 ? `Перенесено: ${ids.length}` : "Задача перенесена", "success");
  }
  // Сделать список задач задачами «на весь день» текущего дня.
  function moveTasksToAllday(ids) {
    if (!ids.length) return;
    store.batch("в весь день", () => ids.forEach(id => store.actions.tasks.update(id, { date: dateRef.current, start_min: null, duration_min: null }).catch(showErr)));
    store.pushToast(ids.length > 1 ? `В «весь день»: ${ids.length}` : "Задача — на весь день", "success");
  }

  // Перестановка задач «весь день»: задаём всем sort_order по новому порядку, где
  // перетаскиваемая встала на позицию overIndex. Одним шагом отмены.
  function persistAllDayOrder(draggedKey, overIndex) {
    const order = allDay.map(i => i.key).filter(k => k !== draggedKey);
    order.splice(clamp(overIndex, 0, order.length), 0, draggedKey);
    store.batch("порядок", () => {
      order.forEach((k, idx) => {
        const it = allDay.find(x => x.key === k);
        if (!it) return;
        const rid = it.kind === "occurrence" ? it.templateId : it.id;
        if ((sortOrderById.get(rid) ?? 0) !== idx) store.actions.tasks.update(rid, { sort_order: idx }).catch(showErr);
      });
    });
  }

  function copyPayload(it, startMin) {
    return { title: it.title || "", notes: it.notes || null, color: it.color || null, icon: it.icon || null,
      list_id: it.list_id || null, date, start_min: startMin, duration_min: it.duration_min || 60 };
  }

  // Мобильное взаимодействие с задачей (как в Apple Календаре): долгое нажатие →
  // задача «приподнимается» (увеличивается + тень, без пульсации) и едет за пальцем
  // в ЛЮБУЮ сторону (свободный 2D-драг через transform). Отпустил — плавно «доезжает»
  // до нового слота и фиксируется там без скачка. Резкий «отброс» в ЛЮБУЮ сторону →
  // отмена: задача так же плавно возвращается на место.
  function onBlockTouch(e, item, tapAction) {
    const pid = e.pointerId;
    const sx = e.clientX, sy = e.clientY;
    const dur = item.duration_min || 0;
    const origDate = dateRef.current; // день, с которого подняли (текущий день вида)
    const already = selected.has(item.key); // уже выделенную двигаем сразу, без удержания
    let lifted = false, moved = false, hold = null;
    const setLiftT = rafThrottle(setLiftDrag);
    let lx = sx, ly = sy, lt = performance.now(), vx = 0, vy = 0; // сглаженная скорость для «отброса»
    // Пока задача поднята — глушим прокрутку. День листает ВТОРОЙ палец через ту же
    // карусель, что и обычный свайп (runDaySwipe); поднятая задача — плавающая копия
    // поверх (fixed), она не уезжает вместе с лентой.
    const onTouchMove = ev => { if (lifted) ev.preventDefault(); };
    clearTimeout(landTimerRef.current); // прервать «доезд» прошлой задачи, если он ещё шёл
    const lift = (select) => {
      lifted = true;
      liftedNowRef.current = true; // синхронно: свайп дня теперь не перехватывает этот жест
      liftItemRef.current = item;
      const g = innerRef.current;
      if (g) {
        const gr = g.getBoundingClientRect();
        liftGeomRef.current = { top: gr.top + (item.start_min / 60) * hourPx, left: gr.left,
          width: gr.width, height: Math.max(MIN_EVENT_PX, (dur / 60) * hourPx) };
      }
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      if (select) setSelected(new Set([item.key]));
      haptic();
      setLiftDrag({ key: item.key, dx: 0, dy: 0, landing: false });
    };
    const move = ev => {
      if (ev.pointerId !== pid) return; // только наш палец (второй — для листания дня)
      const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!lifted) { if (far > 12) cleanup(); return; } // двинул до подъёма — это прокрутка
      if (far > 3) moved = true;
      ev.preventDefault();
      const now = performance.now(), dt = Math.max(1, now - lt);
      vx = vx * 0.5 + ((ev.clientX - lx) / dt) * 0.5;
      vy = vy * 0.5 + ((ev.clientY - ly) / dt) * 0.5;
      lx = ev.clientX; ly = ev.clientY; lt = now;
      // Палец над зоной «весь день» (и задача обычная) → отметим: призрак времени прячем,
      // зона подсветится; на отпускании задача станет задачей на весь день.
      const overAllday = item.kind === "concrete" && dndZoneAt(ev.clientX, ev.clientY) === "allday";
      setLiftT({ key: item.key, dx: ev.clientX - sx, dy: ev.clientY - sy, landing: false, allday: overAllday });
    };
    // Плавный «доезд»: плавающая копия едет transform-ом к слоту (.landing, переход .2s).
    // Когда доехала — фиксируем новое время (задача уже стоит на этом месте в ленте) и
    // убираем копию (кадр done) → видимого скачка нет, копия и реальная задача совпадают.
    const land = (targetDy, commit) => {
      setLiftDrag({ key: item.key, dx: 0, dy: targetDy, landing: true });
      clearTimeout(landTimerRef.current);
      landTimerRef.current = setTimeout(() => {
        commit();
        setLiftDrag({ key: item.key, dx: 0, dy: 0, done: true });
        landTimerRef.current = setTimeout(() => setLiftDrag(c => (c && c.key === item.key && c.done) ? null : c), 60);
      }, 220);
    };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      const dayChanged = dateRef.current !== origDate; // день сменили вторым пальцем (карусель)
      const wasLifted = lifted, mv = moved || dayChanged;
      cleanup();
      if (!wasLifted) { setLiftDrag(null); (tapAction || (() => openPreview(item)))(); return; }
      if (!mv) { setLiftDrag(null); return; } // подняли и отпустили без движения → остаётся выделенной
      // Бросок в зону «весь день» → задача становится задачей на весь день (без времени).
      if (item.kind === "concrete" && dndZoneAt(ev.clientX, ev.clientY) === "allday") {
        setLiftDrag(null); haptic();
        store.actions.tasks.reschedule(item, { date: dateRef.current, start_min: null, duration_min: null }).catch(showErr);
        return;
      }
      const speed = Math.hypot(vx, vy); // px/мс
      if (speed > 1.0) { haptic(); land(0, () => {}); return; } // резкий отброс в любую сторону → отмена (плавно назад)
      // Новое время — от ПОСЛЕДНЕГО положения пальца в move (ly), а НЕ от ev.clientY:
      // у pointerup на iOS координата бывает нулевой/устаревшей → задача прыгала на 00:00.
      // Берём ровно то же значение, что и призрак (он всегда верный).
      const target = clamp(snap(item.start_min + Math.round(((ly - sy) / hourPx) * 60)), 0, 1440 - dur);
      const targetDy = ((target - item.start_min) / 60) * hourPx;
      const newDate = dateRef.current; // мог смениться вторым пальцем
      land(targetDy, () => {
        const patch = {};
        if (target !== item.start_min) patch.start_min = target;
        if (newDate !== origDate) patch.date = newDate; // перенесли на другой день
        if (patch.start_min != null || patch.date) store.actions.tasks.reschedule(item, patch).catch(showErr);
      });
    };
    // Системная отмена жеста (pointercancel) — НЕ коммитим: задача плавно возвращается
    // на место. Раньше cancel шёл в up → задача «соскакивала» в случайном месте.
    const onCancel = (ev) => {
      if (ev.pointerId !== pid) return;
      const wasLifted = lifted;
      cleanup();
      if (wasLifted) land(0, () => {}); else setLiftDrag(null);
    };
    const cleanup = () => {
      clearTimeout(hold);
      liftedNowRef.current = false;
      setLiftT.cancel();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", onTouchMove, { passive: false });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", onCancel);
    if (already) lift(false);                       // уже выделена → поднимаем сразу
    else hold = setTimeout(() => lift(true), 280);  // не выделена → подъём по удержанию
  }

  // Десктоп: свободный 2D-перенос одиночного блока живой копией (как на мобильной).
  // Сама копия блока (та же .tl-event, что в сетке) едет за курсором в любую сторону;
  // над сеткой призрак показывает новое время; над проектом/областью/«Входящими» —
  // подсветка цели и перенос туда; над «весь день» — копия ужимается до капсулы.
  function startBlockLift(e, item, tapAction) {
    const sx = e.clientX, sy = e.clientY;
    const dur = item.duration_min || 0;
    const concrete = item.kind === "concrete";
    let lifted = false, moved = false;
    const setLiftT = rafThrottle(setLiftDrag);
    const setGeom = () => {
      const g = innerRef.current; if (!g) return;
      const gr = g.getBoundingClientRect();
      liftGeomRef.current = { top: gr.top + (item.start_min / 60) * hourPx, left: gr.left,
        width: gr.width, height: Math.max(MIN_EVENT_PX, (dur / 60) * hourPx) };
    };
    const move = (ev) => {
      if (!lifted) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        lifted = true; liftItemRef.current = item; setGeom();
        if (!selected.has(item.key)) setSelected(new Set([item.key]));
      }
      moved = true; ev.preventDefault();
      const sec = concrete ? sectionAt(ev.clientX, ev.clientY) : null;
      const zone = concrete && !sec ? dndZoneAt(ev.clientX, ev.clientY) : null;
      setLiftT({ key: item.key, dx: ev.clientX - sx, dy: ev.clientY - sy, cx: ev.clientX, cy: ev.clientY,
        landing: false, section: sec, allday: zone === "allday", tray: zone === "tray" });
    };
    const up = (ev) => {
      detach();
      if (!lifted || !moved) { setLiftDrag(null); (tapAction || (() => handleTap(item, false)))(); return; }
      const sec = concrete ? sectionAt(ev.clientX, ev.clientY) : null;
      if (sec) { setLiftDrag(null); moveTasksToSection([item.id], sec); return; }
      const zone = concrete ? dndZoneAt(ev.clientX, ev.clientY) : null;
      if (zone === "allday") { setLiftDrag(null); haptic();
        store.actions.tasks.update(item.id, { start_min: null, duration_min: null }).catch(showErr); return; }
      if (zone === "tray") { setLiftDrag(null);
        store.actions.tasks.update(item.id, { date: null, start_min: null, duration_min: null }).catch(showErr); return; }
      // Сетка дня: плавный «доезд» копии к новому времени, затем фиксируем.
      const target = clamp(snap(item.start_min + Math.round(((ev.clientY - sy) / hourPx) * 60)), 0, 1440 - dur);
      const targetDy = ((target - item.start_min) / 60) * hourPx;
      setLiftDrag({ key: item.key, dx: 0, dy: targetDy, landing: true });
      clearTimeout(landTimerRef.current);
      landTimerRef.current = setTimeout(() => {
        if (target !== item.start_min) store.actions.tasks.reschedule(item, { start_min: target }).catch(showErr);
        setLiftDrag({ key: item.key, dx: 0, dy: 0, done: true });
        landTimerRef.current = setTimeout(() => setLiftDrag(c => (c && c.key === item.key && c.done) ? null : c), 60);
      }, 200);
    };
    const cancel = () => { detach(); setLiftDrag(null); };
    const detach = () => { setLiftT.cancel(); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", cancel);
  }

  function onBlockPointerDown(e, item, tapAction) {
    e.stopPropagation();
    if (e.button === 2) return; // правый клик — контекстное меню (карточка)
    if (e.pointerType === "touch") { onBlockTouch(e, item, tapAction); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    const startClientY = e.clientY, startClientX = e.clientX;
    const shift = e.shiftKey;
    const copy = e.altKey; // Option/Alt + перетаскивание — создать копию
    const grab = yToMin(e.clientY) - item.start_min;
    // Если тащим за одну из нескольких выделенных задач — двигаем всю группу.
    const group = !shift && selected.has(item.key) && selected.size > 1
      ? dayTl.filter(i => selected.has(i.key)).map(i => ({ item: i, start: i.start_min, dur: i.duration_min || 0 }))
      : null;
    // Чистый одиночный перенос — свободная живая копия (2D), как на мобильной.
    if (!group && !copy && !shift) { startBlockLift(e, item, tapAction); return; }
    let newStart = item.start_min, moved = false, delta = 0;
    const move = ev => {
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 4) moved = true;
      if (!moved) return;
      if (group) {
        // Над боковой панелью/«весь день» — переносим ВСЁ выделение туда (стопка-карточка),
        // а не двигаем по времени. Копию (Alt) в разделы не уводим.
        const sec = !copy ? sectionAt(ev.clientX, ev.clientY) : null;
        const overAllday = !copy && !sec && dndZoneAt(ev.clientX, ev.clientY) === "allday";
        if (sec || overAllday) {
          setDrag(null);
          setSelDrag({ x: ev.clientX, y: ev.clientY, count: selectedTaskIds().length, dropList: overAllday ? "__allday__" : sec });
          return;
        }
        setSelDrag(null);
        delta = clamp(snap(yToMin(ev.clientY) - grab), 0, 1440) - item.start_min;
        setDrag({ type: copy ? "copyGroup" : "moveGroup", keys: group.map(g => g.item.key), delta });
        return;
      }
      // Утянули в боковую панель или в зону «весь день» — задача «снимается» из
      // сетки (плавающий ярлык + подсветка зоны-приёмника).
      const z = !copy && item.kind === "concrete" ? dndZoneAt(ev.clientX, ev.clientY) : null;
      if (z === "tray" || z === "allday") {
        setDrag(null);
        setDnd({ source: "grid", title: item.title, color: colorOf(item), x: ev.clientX, y: ev.clientY, zone: z });
        return;
      }
      setDnd(null);
      newStart = clamp(snap(yToMin(ev.clientY) - grab), 0, 1440 - item.duration_min);
      setDrag({ type: copy ? "copy" : "move", key: item.key, start: newStart, dur: item.duration_min });
    };
    const detach = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel);
    };
    // Системное прерывание жеста (pointercancel) — НЕ коммитим, просто сбрасываем.
    const cancel = () => { detach(); setDrag(null); setDnd(null); setSelDrag(null); };
    const up = (ev) => {
      detach();
      setDrag(null); setDnd(null); setSelDrag(null);
      if (!moved) { (tapAction || (() => handleTap(item, shift)))(); return; }
      if (copy) {
        const list = group ? group : [{ item, start: item.start_min, dur: item.duration_min || 0 }];
        const off = group ? delta : (newStart - item.start_min);
        for (const g of list) {
          const ns = clamp(g.start + off, 0, 1440 - g.dur);
          store.actions.tasks.create(copyPayload(g.item, ns)).catch(showErr);
        }
      } else if (group) {
        // Сброс выделения в проект/область/входящие или в «весь день» — переносим всё.
        const sec = sectionAt(ev.clientX, ev.clientY);
        const overAllday = !sec && dndZoneAt(ev.clientX, ev.clientY) === "allday";
        if (sec) { moveTasksToSection(selectedTaskIds(), sec); }
        else if (overAllday) { moveTasksToAllday(selectedTaskIds()); }
        else store.batch("перенос", () => {
          for (const g of group) {
            const ns = clamp(g.start + delta, 0, 1440 - g.dur);
            if (ns !== g.start) store.actions.tasks.reschedule(g.item, { start_min: ns }).catch(showErr);
          }
        });
      } else if (item.kind === "concrete" && dndZoneAt(ev.clientX, ev.clientY) === "tray") {
        // В боковую панель — задача уходит из сетки совсем (дату убираем), появляется
        // в списке своего проекта.
        store.actions.tasks.update(item.id, { date: null, start_min: null, duration_min: null }).catch(showErr);
      } else if (item.kind === "concrete" && dndZoneAt(ev.clientX, ev.clientY) === "allday") {
        // В зону «весь день» — снимаем только время (день остаётся).
        store.actions.tasks.update(item.id, { start_min: null, duration_min: null }).catch(showErr);
      } else if (newStart !== item.start_min) {
        store.actions.tasks.reschedule(item, { start_min: newStart }).catch(showErr);
      }
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", cancel);
  }

  // Перетаскивание задачи из боковой панели в сетку дня (назначить время).
  function startTrayDrag(e, t) {
    if (e.button !== 0) return;
    const touch = e.pointerType === "touch";
    if (!touch) e.preventDefault(); // не выделять текст названия при перетаскивании
    const sx = e.clientX, sy = e.clientY;
    let active = false, hold = null;
    const dur = 60;
    const setDndT = rafThrottle(setDnd);
    const update = (ev) => {
      const zone = dndZoneAt(ev.clientX, ev.clientY);
      const gridMin = zone === "grid" && innerRef.current ? clamp(snap(yToMin(ev.clientY)), 0, 1440 - dur) : null;
      setDndT({ source: "tray", title: t.title, color: listById[t.list_id]?.color || "var(--accent)",
        x: ev.clientX, y: ev.clientY, zone, gridMin, dur });
    };
    const begin = (ev) => { active = true; trayClickGuard.current = true; update(ev || { clientX: sx, clientY: sy }); };
    const move = (ev) => {
      if (!active) {
        if (touch) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { clearTimeout(hold); cleanup(); } return; }
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        begin(ev);
      }
      ev.preventDefault();
      update(ev);
    };
    const up = (ev) => {
      clearTimeout(hold); cleanup(); setDndT.cancel();
      if (!active) return;
      if (dndZoneAt(ev.clientX, ev.clientY) === "grid" && innerRef.current) {
        const start = clamp(snap(yToMin(ev.clientY)), 0, 1440 - dur);
        store.actions.tasks.update(t.id, { date, start_min: start, duration_min: dur }).catch(showErr);
      }
      setDnd(null);
      setTimeout(() => { trayClickGuard.current = false; }, 0);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    if (touch) hold = setTimeout(() => begin(), HOLD_MS);
  }

  function onResizePointerDown(e, item) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    let newDur = item.duration_min;
    const setDragT = rafThrottle(setDrag);
    const move = ev => { newDur = clamp(snap(yToMin(ev.clientY) - item.start_min), MIN_DUR, 1440 - item.start_min);
      setDragT({ type: "resize", key: item.key, start: item.start_min, dur: newDur }); };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
      setDragT.cancel();
      if (newDur !== item.duration_min) store.actions.tasks.reschedule(item, { duration_min: newDur }).catch(showErr);
      setDrag(null);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  }

  // Растягивание за верхний край: двигаем начало, конец остаётся на месте.
  function onResizeTopPointerDown(e, item) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    const end = item.start_min + item.duration_min;
    let newStart = item.start_min, newDur = item.duration_min;
    const setDragT = rafThrottle(setDrag);
    const move = ev => {
      newStart = clamp(snap(yToMin(ev.clientY)), 0, end - MIN_DUR);
      newDur = end - newStart;
      setDragT({ type: "resize", key: item.key, start: newStart, dur: newDur });
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
      setDragT.cancel();
      if (newStart !== item.start_min) store.actions.tasks.reschedule(item, { start_min: newStart, duration_min: newDur }).catch(showErr);
      setDrag(null);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  }

  function openEdit(item) {
    const row = item.kind === "concrete" ? tasks.find(t => t.id === item.id) : tasks.find(t => t.id === item.templateId);
    if (row) setEditing({ task: row, occ: item.kind === "occurrence" ? item : null });
  }
  const toggleDone = (item) => {
    doneFeedback();
    return store.actions.tasks.toggleDone(item).catch(showErr);
  };
  // Конфетти при выполнении задачи — эмодзи-частицы.
  const CONFETTI = ["✅"];
  function makeBits() {
    return Array.from({ length: 15 }, () => {
      const a = Math.random() * Math.PI * 2, dist = 22 + Math.random() * 34;
      return { dx: Math.round(Math.cos(a) * dist), dy: Math.round(Math.sin(a) * dist),
        rot: (Math.random() * 120 - 60) | 0, emoji: CONFETTI[(Math.random() * CONFETTI.length) | 0], d: (Math.random() * 80) | 0 };
    });
  }
  // Хлопок конфетти у любого чекбокса (по уникальному ключу).
  function popConfetti(key) {
    const id = Date.now() + Math.random();
    setConfetti({ key, id, bits: makeBits() });
    setTimeout(() => setConfetti(c => (c && c.id === id) ? null : c), 1200);
  }
  // Конфетти-элемент для вставки рядом с чекбоксом (cls="center" — по центру кнопки).
  const confettiEl = (key, cls) => (confetti && confetti.key === key)
    ? html`<span class=${"confetti" + (cls ? " " + cls : "")}>
        ${confetti.bits.map((b, n) => html`<span class="confetti-bit" key=${n}
          style=${`--dx:${b.dx}px;--dy:${b.dy}px;--rot:${b.rot};animation-delay:${b.d}ms;`}>${b.emoji}</span>`)}
      </span>` : "";
  // Завершение задачи в сетке: конфетти + падение шарика-чекбокса вниз капсулы.
  function completeToggle(item) {
    if (!item.done) {
      popConfetti(item.key);
      const k = item.key; setFallKey(k);
      setTimeout(() => setFallKey(fk => fk === k ? null : fk), 3300);
    }
    return toggleDone(item);
  }
  function taskMeta(t) {
    if (!t.date) return "без времени";
    const dd = fromISO(t.date);
    const base = relLabel(t.date) || `${dd.getDate()} ${monthGen(dd)}`;
    return t.start_min !== null && t.start_min !== undefined ? `${base}, ${minToHHMM(t.start_min)}` : base;
  }
  // Куда положить новую задачу с учётом текущего фильтра панели: в проект,
  // прямо в область (area:<id>) или во «Входящие» (Все/Входящие/спецразделы).
  function newTaskTarget() {
    if (filter && filter.startsWith("area:")) return { list_id: null, area_id: filter.slice(5) };
    if (filter === "all" || filter === "inbox" || special) return { list_id: null, area_id: null };
    return { list_id: filter, area_id: null };
  }
  function quickSchedule(t) {
    const now = new Date();
    const start = date === todayISO() ? clamp(snap(now.getHours() * 60 + now.getMinutes() + 5), 0, 1440 - 60) : 9 * 60;
    store.actions.tasks.update(t.id, { date, start_min: start, duration_min: 60 }).catch(showErr);
  }
  // Свайп влево по строке проекта (тач) открывает кнопки «Изменить/Удалить».
  function projSwipe(e, l) {
    if (e.pointerType !== "touch") return;
    const el = e.currentTarget;
    const startX = e.clientX, startY = e.clientY;
    const wasOpen = swipeId === l.id;
    let decided = false, horiz = false, dx = 0;
    const move = (ev) => {
      const mx = ev.clientX - startX, my = ev.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true; horiz = Math.abs(mx) > Math.abs(my);
        if (!horiz) { cleanup(); return; }
        swipedRef.current = true;
      }
      ev.preventDefault();
      dx = clamp((wasOpen ? -132 : 0) + mx, -132, 0);
      el.style.transform = `translateX(${dx}px)`;
    };
    const up = () => {
      cleanup();
      if (!horiz) return;
      el.style.transform = "";
      setSwipeId(dx < -50 ? l.id : null);
      setTimeout(() => { swipedRef.current = false; }, 0);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }
  function selectProj(l) {
    if (swipedRef.current) { swipedRef.current = false; return; }
    if (swipeId === l.id) { setSwipeId(null); return; }
    // Клик по проекту только раскрывает/сворачивает его задачи. Сетку дня это НЕ
    // фильтрует (она всегда показывает все задачи).
    toggleListExpand(l.id);
  }
  // Открытые задачи раздела для бокового списка — ТОЛЬКО без даты. Задачи с датой
  // живут в сетке дня и в боковом списке не показываются (без дублирования).
  // target: id проекта, "inbox" (без проекта/области), либо "area:<id>" (прямо в области).
  const openTasksOfList = (target) => tasks
    .filter(t => !t.recurrence_parent && !t.deleted_at && !t.done && !t.date
      && (target === "inbox" ? (!t.list_id && !t.area_id)
        : (typeof target === "string" && target.indexOf("area:") === 0) ? (!t.list_id && t.area_id === target.slice(5))
        : t.list_id === target))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)
      || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const treeTarget = (t) => t.list_id ? t.list_id : (t.area_id ? "area:" + t.area_id : "inbox");

  // Новый порядок задач без даты внутри раздела: переставленную вставляем на overIndex,
  // всем строкам пишем sort_order по новому порядку.
  function persistTreeOrder(target, draggedId, overIndex) {
    const ids = openTasksOfList(target).map(t => t.id).filter(id => id !== draggedId);
    ids.splice(clamp(overIndex, 0, ids.length), 0, draggedId);
    store.batch("порядок", () => {
      ids.forEach((id, idx) => {
        const t = tasks.find(x => x.id === id);
        if (t && (t.sort_order || 0) !== idx) store.actions.tasks.update(id, { sort_order: idx }).catch(showErr);
      });
    });
  }

  // Перетаскивание задачи в боковом дереве. Зажал — задача «поднимается» (живая
  // карточка едет под пальцем), соседи расступаются. Тянешь в сетку дня — задача
  // плавно «приземляется» блоком (получает дату/время). Внутри списка — меняешь
  // порядок (любую на любое место).
  function startTreeDrag(e, t, fromAllday) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType !== "touch") return;
    const touch = e.pointerType === "touch";
    const rowEl = e.currentTarget;
    const r = rowEl.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const offX = sx - r.left, offY = sy - r.top;
    const source = treeTarget(t);
    const color = listById[t.list_id]?.color || "var(--inbox)";
    const dur = 60;
    // У боковых задач дата в .date, у элементов «весь день» — в .occDate.
    const dated = !!(t.date || t.occDate);
    let active = false, hold = null;
    // Исходные позиции капсул «весь день» (снимок на старте, ДО живой перестановки) —
    // чтобы индекс вставки считался по стабильной сетке, а не по уже сдвинувшимся
    // капсулам (иначе индекс «зацикливался» и капсулы разлетались).
    let adSlots = null;
    const measureAdSlots = () => {
      const grid = adGridRef.current; if (!grid) { adSlots = []; return; }
      adSlots = [...grid.querySelectorAll(".allday-item[data-adkey]")].map(n => {
        const rr = n.getBoundingClientRect();
        return { key: n.dataset.adkey, top: rr.top, bottom: rr.bottom, midX: rr.left + rr.width / 2 };
      });
    };
    // Куда вставить капсулу при перестановке внутри «весь день» (читательский порядок),
    // считаем по неподвижному снимку adSlots.
    const adIndexAt = (cx, cy) => {
      if (!adSlots) return 0;
      let idx = 0;
      for (const s of adSlots) {
        if (s.key === t.key) continue;
        if (cy > s.bottom) { idx++; continue; }            // курсор ниже ряда — капсула раньше
        if (cy >= s.top) { if (cx > s.midX) idx++; continue; } // в ряду — левее курсора
        break;                                             // курсор выше — дальше все позже
      }
      return idx;
    };
    // Куда сейчас целимся: сетка дня, зона «весь день», раздел (проект/область/входящие)
    // или перестановка внутри своего списка. «Весь день» проверяем ДО сетки (он внутри неё).
    const overAt = (cx, cy) => {
      const el = document.elementFromPoint(cx, cy);
      if (!el) return { zone: null };
      if (el.closest(".allday")) return fromAllday ? { zone: "allday", adIndex: adIndexAt(cx, cy) } : { zone: "allday" };
      if (el.closest(".planner-grid-scroll") && innerRef.current)
        return { zone: "grid", gridMin: clamp(snap(yToMin(cy)), 0, 1440 - dur) };
      const cont = el.closest("[data-listtasks]");
      const row = el.closest("[data-droplist]");
      const dropList = cont ? cont.dataset.listtasks : row ? row.dataset.droplist : null;
      if (dropList != null) {
        // Без даты + свой список → перестановка; иначе — перенос в раздел.
        if (!dated && dropList === source && cont) {
          const rows = [...cont.querySelectorAll("[data-treekey]")].filter(n => n.dataset.treekey !== t.id && n.dataset.treekey !== "__ph__");
          let idx = rows.findIndex(n => { const rr = n.getBoundingClientRect(); return cy < rr.top + rr.height / 2; });
          if (idx === -1) idx = rows.length;
          return { zone: "tree", overIndex: idx };
        }
        return { zone: "section", dropList };
      }
      return { zone: null };
    };
    const begin = (cx, cy) => {
      active = true; trayClickGuard.current = true; haptic();
      if (fromAllday) measureAdSlots(); // снимок исходных позиций капсул до перестановки
      setTreeDrag({ id: t.id, key: t.key, source, title: t.title, color, isEvent: !!t.is_event, w: r.width, h: r.height,
        offX, offY, x: cx, y: cy, dur, ...overAt(cx, cy) });
    };
    const onTouchMove = (ev) => { if (active) ev.preventDefault(); };
    const setTreeDragT = rafThrottle(setTreeDrag);
    const move = (ev) => {
      if (!active) {
        if (touch) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { clearTimeout(hold); cleanup(); } return; }
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        begin(ev.clientX, ev.clientY);
      }
      ev.preventDefault();
      setTreeDragT(d => d && ({ ...d, x: ev.clientX, y: ev.clientY, ...overAt(ev.clientX, ev.clientY) }));
    };
    const endCard = () => { setTreeDrag(d => d && ({ ...d, dropping: true })); setTimeout(() => setTreeDrag(null), 150); };
    const up = (ev) => {
      clearTimeout(hold); cleanup(); setTreeDragT.cancel();
      if (!active) { setTreeDrag(null); setTimeout(() => { trayClickGuard.current = false; }, 0); return; }
      const o = overAt(ev.clientX, ev.clientY);
      if (o.zone === "grid" && innerRef.current) {
        const g = innerRef.current.getBoundingClientRect();
        const h = Math.max(MIN_EVENT_PX, (dur / 60) * hourPx);
        // «Приземление»: карточка плавно доезжает в слот сетки, затем фиксируем задачу.
        setTreeDrag(d => d && ({ ...d, landing: true, landX: g.left, landY: g.top + (o.gridMin / 60) * hourPx, landW: g.width, landH: h }));
        setTimeout(() => {
          store.actions.tasks.update(t.id, { date: dateRef.current, start_min: o.gridMin, duration_min: dur }).catch(showErr);
          setTreeDrag(null);
        }, 240);
      } else if (o.zone === "allday") {
        if (fromAllday && o.adIndex != null) {
          // Перестановка капсул внутри «весь день».
          persistAllDayOrder(t.key, o.adIndex);
          setTreeDrag(null);
        } else {
          // В «весь день» текущего дня: дата дня, без времени; проект/область сохраняем.
          store.actions.tasks.update(t.id, { date: dateRef.current, start_min: null, duration_min: null }).catch(showErr);
          endCard();
        }
      } else if (o.zone === "section") {
        const dl = o.dropList;
        // Если перетаскиваемая задача входит в выделение из нескольких — переносим всё.
        if (t.key && selected.has(t.key) && selected.size > 1) {
          moveTasksToSection(selectedTaskIds(), dl);
        } else {
          const clear = { date: null, start_min: null, duration_min: null };
          let patch;
          if (dl === "inbox") patch = { list_id: null, area_id: null, ...clear };
          else if (dl.indexOf("area:") === 0) patch = { area_id: dl.slice(5), list_id: null, ...clear };
          else patch = { list_id: dl, area_id: null, ...clear };
          store.actions.tasks.update(t.id, patch).catch(showErr);
          // Раскрываем цель, чтобы перенесённая задача сразу была видна.
          if (dl.indexOf("area:") === 0) setAreaCollapsed(prev => { const n = new Set(prev); n.delete(dl.slice(5)); writeCollapsed(n); return n; });
          else setExpandedLists(prev => { const n = new Set(prev); n.add(dl); return n; });
        }
        endCard();
      } else if (o.zone === "tree" && o.overIndex != null) {
        persistTreeOrder(source, t.id, o.overIndex);
        setTreeDrag(null);
      } else {
        setTreeDrag(null);
      }
      setTimeout(() => { trayClickGuard.current = false; }, 0);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("touchmove", onTouchMove, { passive: false });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    if (touch) hold = setTimeout(() => begin(sx, sy), HOLD_MS);
  }

  // FLIP: строки задач в дереве плавно доезжают на новые места при перестановке/
  // расступании под перетаскиваемой задачей.
  useLayoutEffect(() => {
    const nodes = document.querySelectorAll(".planner-tree .tree-task, .planner-tree .tree-ph");
    const seen = new Set();
    nodes.forEach(node => {
      const key = node.dataset.treekey;
      if (!key) return;
      seen.add(key);
      const rr = node.getBoundingClientRect();
      const prev = treeRects.current.get(key);
      if (prev) {
        const dx = prev.left - rr.left, dy = prev.top - rr.top;
        if (dx || dy) {
          node.style.transition = "none";
          node.style.transform = `translate(${dx}px,${dy}px)`;
          requestAnimationFrame(() => {
            node.style.transition = "transform .24s cubic-bezier(.2,.9,.25,1)";
            node.style.transform = "";
          });
        }
      }
      treeRects.current.set(key, rr);
    });
    for (const k of [...treeRects.current.keys()]) if (!seen.has(k)) treeRects.current.delete(k);
  }, [tasks, expandedLists, areaCollapsed, treeDrag && treeDrag.id, treeDrag && treeDrag.zone, treeDrag && treeDrag.overIndex]);

  function shift(delta) {
    const d = fromISO(dateRef.current);
    if (view === "month") d.setMonth(d.getMonth() + delta);
    else if (view === "week") d.setDate(d.getDate() + delta * 7);
    else d.setDate(d.getDate() + delta);
    dateRef.current = toISO(d); // синхронно — чтобы листать дни подряд без потери шага
    setDate(dateRef.current);
  }
  function openDay(iso) { setDate(iso); setView("day"); }

  // Живой свайп пальцем для недели/месяца — карусель за пальцем, как у дня:
  // тянем ленту, на отпускании доезжаем к соседнему периоду или возвращаемся.
  function onCarouselSwipeStart(e) {
    if (e.touches.length !== 1) return;
    if (!asideOpen && e.touches[0].clientX < EDGE_ZONE) { edgeSwipe(e, "open"); return; } // от левого края — шторка
    const track = trackRef.current;
    if (!track) return;
    if (commitFinalizeRef.current) commitFinalizeRef.current();
    const sc = view === "week" ? weekScrollRef.current : monthRef.current;
    const W = sc ? sc.getBoundingClientRect().width : window.innerWidth;
    const sx = e.touches[0].clientX, sy = e.touches[0].clientY;
    let horiz = null, dx = 0, lastX = sx, lastT = performance.now(), vx = 0, peeked = false;
    const move = ev => {
      const t = ev.touches[0]; if (!t) return;
      dx = t.clientX - sx; const dy = t.clientY - sy;
      if (horiz === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        horiz = Math.abs(dx) > Math.abs(dy) * 0.7;
        if (!horiz) { cleanup(); return; }
      }
      if (!horiz) return;
      ev.preventDefault();
      if (!peeked) { peeked = true; clearTimeout(peekTimerRef.current); setPeek(true); swipingRef.current = true; }
      const now = performance.now(); if (now > lastT) vx = (t.clientX - lastX) / (now - lastT); lastX = t.clientX; lastT = now;
      track.style.transition = "none";
      track.style.transform = `translateX(calc(-100% + ${dx}px))`;
    };
    const finish = () => {
      cleanup(); swipingRef.current = false;
      if (!horiz) return;
      const commit = Math.abs(dx) > Math.min(60, W * 0.14) || Math.abs(vx) > 0.18;
      if (commit) daySwipeCommit(dx < 0 ? 1 : -1); else daySwipeSnapBack();
    };
    const cleanup = () => {
      document.removeEventListener("touchmove", move, { passive: false });
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
    };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
  }

  // Лента сейчас на позиции -100%+dx (её тянули пальцами) — плавно доводим до
  // соседней панели, затем (на transitionend) мгновенно возвращаем в центр уже с
  // новым днём. Видимый час сохраняем (keepGridTop) — чтобы сетка не прыгнула.
  function daySwipeCommit(dir) {
    const track = trackRef.current;
    if (!track) return;
    const td = fromISO(dateRef.current); td.setDate(td.getDate() + dir);
    setPendingDate(toISO(td));
    haptic();
    const finalize = () => {
      if (commitFinalizeRef.current !== finalize) return;
      commitFinalizeRef.current = null;
      clearTimeout(safety);
      track.removeEventListener("transitionend", finalize);
      swipingRef.current = false;
      keepScrollRef.current = true;
      pendingRecenterRef.current = true;
      shift(dir);
      setPendingDate(null);
    };
    commitFinalizeRef.current = finalize;
    track.style.transition = "transform 340ms cubic-bezier(.22,.61,.36,1)";
    void track.offsetWidth;
    track.style.transform = `translateX(${dir > 0 ? "-200%" : "0%"})`;
    track.addEventListener("transitionend", finalize);
    // Подстраховка: если transitionend не придёт (вкладка ушла в фон, переход
    // прервали) — доводим вручную, чтобы карусель не зависла.
    const safety = setTimeout(finalize, 420);
  }
  // Свайпа не хватило — лента плавно возвращается в центр (день не меняется).
  function daySwipeSnapBack() {
    const track = trackRef.current;
    if (!track) return;
    swipingRef.current = false;
    track.style.transition = "transform .28s cubic-bezier(.22,.61,.36,1)";
    void track.offsetWidth;
    track.style.transform = "translateX(-100%)";
    const onBack = () => { clearTimeout(safety); track.removeEventListener("transitionend", onBack); track.style.transition = ""; track.style.transform = ""; schedulePeekOff(); };
    track.addEventListener("transitionend", onBack);
    const safety = setTimeout(onBack, 380); // на случай, если transitionend не сработает
  }

  // Панель проектов — нижний слой, всегда под экраном «День». Жест тянет ВЕРХНИЙ
  // слой (экран дня) вбок: от левого края — уезжает вправо, открывая панель под ним;
  // от правого края (когда панель открыта) — возвращается на место. Слой едет за
  // пальцем, после отпускания мягко доезжает.
  function edgeSwipe(e, mode) {
    const el = contentRef.current;
    if (!el) return;
    const sx = e.touches[0].clientX, sy = e.touches[0].clientY;
    const W = el.offsetWidth; // ширина слоя «День» = на столько он уезжает вправо
    const base = mode === "open" ? 0 : W; // позиция слоя «День» в начале жеста
    let decided = null, cur = base, lastX = sx, lastT = performance.now(), vx = 0;
    const move = ev => {
      const t = ev.touches[0]; if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (decided === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = Math.abs(dx) > Math.abs(dy);
        if (!decided) { cleanup(); return; } // вертикаль — это прокрутка, не панель
      }
      const now = performance.now();
      if (now > lastT) vx = (t.clientX - lastX) / (now - lastT);
      lastX = t.clientX; lastT = now;
      cur = Math.max(0, Math.min(W, base + dx)); // слой «День» уходит вправо до +W
      el.style.transition = "none";
      el.style.transform = `translateX(${cur}px)`;
    };
    const end = () => {
      cleanup();
      if (decided !== true) return;
      let open;
      if (vx > 0.2) open = true;        // флик вправо — открыть панель (слой уезжает)
      else if (vx < -0.2) open = false; // флик влево — вернуть экран дня
      else open = cur > W / 2;          // больше половины — доводим в эту сторону
      el.style.transition = "transform .5s cubic-bezier(.22,1,.3,1)";
      el.style.transform = `translateX(${open ? W : 0}px)`;
      setAsideOpen(open);
      const onEnd = () => { el.removeEventListener("transitionend", onEnd); el.style.transition = ""; el.style.transform = ""; };
      el.addEventListener("transitionend", onEnd);
    };
    const cleanup = () => {
      document.removeEventListener("touchmove", move, { passive: true });
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
  }
  function onAsideSwipeStart(e) {
    if (e.touches.length !== 1) return;
    if (e.touches[0].clientX < window.innerWidth - EDGE_ZONE) return; // только от правого края
    edgeSwipe(e, "close");
  }
  // Соседние дни оставляем смонтированными ещё немного после свайпа — чтобы при
  // быстром листании подряд не перерисовывать их каждый раз (без рывков).
  function schedulePeekOff() {
    clearTimeout(peekTimerRef.current);
    peekTimerRef.current = setTimeout(() => setPeek(false), 700);
  }

  // Свайп по сетке дня — карусель «как в Apple»: лента из трёх дней (вчера/
  // сегодня/завтра) едет за пальцем с лёгким сопротивлением, соседний день виден
  // Сетка дня: касаниями карусель листает САМ браузер (CSS scroll-snap). Здесь
  // обрабатываем только: (а) свайп от левого края — открыть шторку проектов,
  // (б) два пальца — зафиксировать точку для зум-якоря.
  // Ручка-шторка зоны «весь день»: тянем пальцем — высота меняется ровно за пальцем,
  // от полностью закрытой (0) до половины экрана. Часы при этом заполняют остаток
  // (hp = остаток/24), поэтому день всегда вписан без прокрутки и пустоты. Отпустил
  // — осталось как есть.
  function onAllDayHandleDown(e) {
    e.preventDefault();
    const el = scrollRef.current, grid = innerRef.current, track = trackRef.current;
    const cs = el ? getComputedStyle(el) : null;
    const padT = cs ? parseFloat(cs.paddingTop) || 0 : 0;
    const padB = cs ? parseFloat(cs.paddingBottom) || 0 : 0;
    const startH = adH;
    // «Лишнее» помимо часов и самой шторки (ручка, отступы, бордюры): высота ленты −
    // высота сетки − текущая высота шторки. Дальше остаток под часы = экран − это − nh.
    const extra = (track && grid) ? Math.max(0, track.offsetHeight - grid.offsetHeight) : 0;
    const avail = el ? el.clientHeight - padT - padB - (extra - startH) : 0;
    const startY = e.clientY;
    const maxH = Math.round((window.visualViewport?.height || window.innerHeight) * 0.5);
    const move = (ev) => {
      const nh = clamp(Math.round(startH + (ev.clientY - startY)), 0, maxH);
      setAdHeight(nh);
      if (avail > 0) setHourPx(clamp((avail - nh) / 24, HOUR_MIN, HOUR_MAX)); // часы занимают остаток
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }
  // Единая механика свайпа дней (карусель st). Используется и для обычного свайпа, и
  // для мультитача (второй палец, пока держим задачу/капсулу) — одна и та же физика,
  // один свайп = один день, та же инерция и доводка. Палец отслеживаем по identifier,
  // чтобы не путать пальцы при мультитаче. multi=true — свайп вторым пальцем (не уступаем
  // создание/перенос: они идут параллельно своим обработчиком).
  function runDaySwipe(touch, multi) {
    const st = daySwipeStateRef.current;
    if (view !== "day" || !st || !touch) return;
    const id = touch.identifier;
    const sx = touch.clientX, sy = touch.clientY;
    let horiz = null, startDx = 0;
    const find = (list) => { for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i]; return null; };
    const move = (ev) => {
      if (!multi && (createActiveRef.current || liftedNowRef.current)) { if (horiz === true) st.snap(); cleanup(); return; } // обычный свайп уступил создание/подъёму задачи
      const t = find(ev.touches); if (!t) return;
      const dxF = t.clientX - sx, dyF = t.clientY - sy;
      if (horiz === null && (Math.abs(dxF) > 5 || Math.abs(dyF) > 5)) {
        horiz = Math.abs(dxF) > Math.abs(dyF) * 0.7;
        if (!horiz) { cleanup(); return; }
        // Прерываем текущую анимацию ТОЛЬКО когда реально начали горизонтальный свайп.
        // Иначе обычный тап (без свайпа) останавливал бы доводку дня на полпути → залипание.
        startDx = st.getDx(); st.cancel();
        clearTimeout(peekTimerRef.current); setPeek(true); // соседние дни рисуем только на время свайпа
      }
      if (!horiz) return;
      ev.preventDefault();
      st.setDx(startDx + dxF);
    };
    const end = (ev) => {
      if (find(ev.touches)) return; // наш палец ещё на экране — свайп продолжается
      cleanup(); if (horiz === true) st.snap();
    };
    const cleanup = () => {
      document.removeEventListener("touchmove", move, { passive: false });
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
  }
  function onDaySwipeStart(e) {
    // Держим задачу/капсулу → НОВЫЙ (второй) палец листает день той же каруселью.
    if (liftDragRef.current || createActiveRef.current) { runDaySwipe(e.changedTouches[0], true); return; }
    if (e.touches.length === 2) {
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomFocus.current = computeAnchor(midY);
      return;
    }
    if (e.touches.length !== 1) return;
    if (e.target && e.target.closest && e.target.closest(".allday-handle")) return; // ручку шторки ведёт её собственный drag
    if (!asideOpen && e.touches[0].clientX < EDGE_ZONE) { edgeSwipe(e, "open"); return; }
    // Свайп дня вооружаем и поверх задач: горизонтальное протягивание листает день.
    // Обработчик задачи работает параллельно (он поднимает задачу только по удержанию
    // ~280мс; быстрый горизонтальный свайп его отменяет). Если задача всё же поднята
    // (liftedNowRef) — runDaySwipe сам уступает, и задача переносится, а не листает.
    runDaySwipe(e.touches[0], false);
  }
  function rowToItem(row) {
    return {
      key: row.id, kind: "concrete", id: row.id, templateId: null,
      occDate: row.date, recurring: false, done: !!row.done,
      title: row.title || "", notes: row.notes || "", color: row.color || null,
      icon: row.icon || null, list_id: row.list_id || null,
      start_min: row.start_min, duration_min: row.duration_min,
      subtasks: Array.isArray(row.subtasks) ? row.subtasks : [],
    };
  }
  function openPreview(item) { openEdit(item); }

  const d = fromISO(date);
  const monthLabel = `${monthNom(d)[0].toUpperCase()}${monthNom(d).slice(1)} ${d.getFullYear()}`;
  // Подпись в шапке нужна только для недели/месяца — в режиме «День» дату
  // показывает полоса недели снизу, поэтому текст там не выводим.
  const headLabel = view === "week" ? weekRangeLabel(date) : monthLabel;
  const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const isToday = date === todayISO();
  const dayTl = useMemo(() => [...timed].sort((a, b) => (a.vTop - b.vTop) || ((a.vEnd - a.vTop) - (b.vEnd - b.vTop))), [timed]);
  // Раскладка пересекающихся задач по колонкам (как в Календаре Apple). СТАТИЧНАЯ:
  // соседние задачи стоят на месте и НЕ двигаются при переносе. В сторону уезжает
  // только призрак перетаскиваемой задачи (см. ghostLane ниже) — он обтекает чужие
  // капсулы, а не толкает их.
  const dayCols = useMemo(() => {
    const m = new Map();
    for (const it of layoutColumns(dayTl, null)) m.set(it.key, { col: it._col, cols: it._cols });
    return m;
  }, [dayTl]);

  // ---- Встроенный редактор: где монтировать (одно из трёх мест) ----
  const edTask = editing?.task || null;
  // Закрытие с анимацией: сперва проигрываем уход (класс .closing), затем размонтируем.
  const closeEditor = () => {
    if (edClosing) return;
    setEdClosing(true);
    setTimeout(() => { setEditing(null); setCreating(null); setEdClosing(false); }, 240);
  };
  const editorEl = (editing || creating)
    ? html`<${TaskEditor} key=${editing ? "e" + editing.task.id : "c"}
        initial=${editing ? editing.task : undefined}
        occ=${editing ? editing.occ : undefined}
        defaults=${creating || undefined}
        onClose=${closeEditor} />`
    : null;
  // Минута начала задачи, к которой привязываем форму (для повторов — позиция
  // конкретного повторения на текущем дне). null — у задачи нет времени/другой день.
  const edAnchorMin = view === "day"
    ? (editing && editing.occ && editing.occ.start_min != null ? editing.occ.start_min
      : editing && edTask && edTask.date === date && edTask.start_min != null ? edTask.start_min
      : creating && creating.date === date && creating.start_min != null ? creating.start_min
      : null)
    : null;
  // Десктоп: форма прирастает к блоку прямо в сетке (ed-anchor). Мобильный: форму
  // в саму сетку класть нельзя (у .planner-grid-scroll user-select:none — в
  // standalone-PWA это гасит клавиатуру). Поэтому на телефоне форма — оверлей вне
  // сетки, который мы позиционируем по блоку через useLayoutEffect ниже.
  const edGridMin = !isMobile ? edAnchorMin : null;
  // Задачи без даты (и быстрое создание) теперь правим/создаём отдельной плавающей
  // карточкой — отдельного нижнего списка в панели больше нет.
  const edPanel = false;
  // Плавающая карточка — всё остальное (другой день, не «День», и т.п.).
  const edFloat = !!(editing || creating) && edGridMin == null && !edPanel;
  // На мобильном привязываем оверлей формы к блоку задачи: карточка встаёт на уровень
  // блока (как на десктопе), но физически остаётся вне сетки — клавиатура не страдает.
  const edAnchorMobile = isMobile && edFloat && edAnchorMin != null;
  useLayoutEffect(() => {
    const back = edBackRef.current;
    if (!back) return;
    const card = back.querySelector(".ed-card");
    if (!card) return;
    if (!edAnchorMobile) { card.style.marginTop = ""; return; } // не привязано — обычный лист снизу
    const grid = innerRef.current;
    if (!grid) return;
    // Желаемый верх карточки = экранная Y блока задачи; ограничиваем, чтобы форма не
    // уезжала за верх/низ экрана (с отступами под safe-area).
    const gridTop = grid.getBoundingClientRect().top;
    const blockY = gridTop + (edAnchorMin / 60) * hourPx;
    const vh = window.innerHeight;
    const ch = card.offsetHeight || 0;
    const top = clamp(blockY, 56, Math.max(56, vh - ch - 16));
    card.style.marginTop = top + "px";
  }, [edAnchorMobile, edAnchorMin, hourPx, editing, creating, isMobile]);

  const prevDate = (() => { const x = fromISO(date); x.setDate(x.getDate() - 1); return toISO(x); })();
  const nextDate = (() => { const x = fromISO(date); x.setDate(x.getDate() + 1); return toISO(x); })();
  // Статичная (без жестов) панель соседнего дня — для предпросмотра в карусели.
  function dayStaticPane(pd) {
    const items = itemsForDate(tasks, pd)
      .filter(i => i.vTop !== null && i.vTop !== undefined)
      .sort((a, b) => (a.vTop - b.vTop) || ((a.vEnd - a.vTop) - (b.vEnd - b.vTop)));
    const td = pd === todayISO();
    // Столбцы как в основном виде — иначе пересекающиеся блоки сливаются во всю ширину.
    const colMap = new Map();
    for (const it of layoutColumns(items, null)) colMap.set(it.key, { col: it._col, cols: it._cols });
    return html`<div class="tl tl-static" style=${`height:${24 * hourPx}px;`}>
      ${Array.from({ length: 25 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
        <span class=${"grid-hour-label" + (h === 24 ? " last" : "")}>${(h % 24 === 0 ? "00" : String(h).padStart(2, "0"))}:00</span></div>`)}
      <div class="tl-spine"></div>
      ${td && html`<div class="grid-now" style=${`top:${(nowMin / 60) * hourPx}px;`}>
        <span class="grid-now-time">${minToHHMM(nowMin)}</span><span class="grid-now-dot"></span></div>`}
      ${items.map(i => {
        const top = (i.vTop / 60) * hourPx;
        const height = Math.max(MIN_EVENT_PX, ((i.vEnd - i.vTop) / 60) * hourPx);
        const density = height >= 44 ? "" : height >= 24 ? " compact" : " mini";
        const spanning = i.spanTop || i.spanBottom || i.cont;
        const slot = colMap.get(i.key);
        const cols = (spanning || !slot) ? 1 : slot.cols;
        const colStyle = cols > 1 ? `--cols:${cols};--col:${slot.col};` : "";
        const isEv = i.is_event;
        const evCls = isEv ? " tl-ev tl-bar-" + (i.card_bar || "none") + " tl-bg-" + (i.card_bg || "clean") : "";
        const waveVar = (isEv && (i.card_bg === "waves" || i.card_bg === "waves2")) ? "--wave:" + waveDataUrl(colorOf(i), i.card_bg) + ";" : "";
        return html`<div class=${"tl-event" + density + evCls + (cols > 1 ? " columned" : "") + (i.done ? " done" : "") + (i.spanTop ? " span-top" : "") + (i.spanBottom ? " span-bottom" : "")} key=${i.key}
          style=${`top:${top}px;height:${height}px;--c:${colorOf(i)};${colStyle}${waveVar}`}>
          ${isEv && i.card_bar && i.card_bar !== "none" && html`<div class=${"tl-evbar " + i.card_bar}></div>`}
          <div class="tl-pill">${!isEv ? html`<span class=${"tl-pill-check" + (i.done ? " on" : "")} style=${`--drop:${Math.max(0, height - 34)}px;`}>${Icon.check()}</span>` : ""}</div>
          <div class="tl-body"><div class="tl-text">
            <div class="tl-titlerow">
              <div class="tl-title">${i.title}${i.recurring ? html` <span class="tl-rep">${Icon.repeat()}</span>` : ""}</div>
            </div>
            <div class="tl-meta">${minRangeLabel(i.start_min, i.duration_min || 0)} (${durHuman(i.duration_min || 0)})</div>
          </div></div>
        </div>`;
      })}
    </div>`;
  }
  // Соседняя панель в карусели дня: статичные задачи «весь день» + статичная сетка.
  // Чтобы зона «весь день» уезжала вместе со свайпом, она лежит внутри каждой панели.
  function dayPeekPane(pd) {
    const all = itemsForDate(tasks, pd)
      .filter(i => (i.start_min === null || i.start_min === undefined));
    const rowIdOfX = (i) => i.kind === "occurrence" ? i.templateId : i.id;
    all.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1)
      || ((sortOrderById.get(rowIdOfX(a)) ?? 0) - (sortOrderById.get(rowIdOfX(b)) ?? 0))
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return html`<div class="tl-peek">
      <div class=${"allday" + (all.length === 0 ? " empty" : "") + (all.length ? " grid" : "")} style=${`--adh:${AD_COLLAPSED}px`}>
        ${all.map(i => html`<div class=${"allday-item" + (i.done ? " done" : "")} key=${i.key} style=${`--c:${colorOf(i)};`}>
          ${i.is_event
            ? html`<span class="allday-evmark" style=${`background:${colorOf(i)};`}></span>`
            : html`<span class=${"allday-check" + (i.done ? " on" : "")} style=${`border-color:${colorOf(i)};color:${colorOf(i)};`}>${Icon.check()}</span>`}
          <span class="allday-title">${i.title}</span>
        </div>`)}
      </div>
      <div class="allday-handle"><span class="allday-grip"></span></div>
      ${dayStaticPane(pd)}
    </div>`;
  }

  // Данные недели/месяца для произвольной даты (для соседних панелей карусели).
  function buildWeekDays(baseISO) {
    const mon = weekStart(baseISO);
    return Array.from({ length: 7 }, (_, k) => {
      const dd = new Date(mon); dd.setDate(mon.getDate() + k);
      const iso = toISO(dd);
      const items = itemsForDate(tasks, iso);
      const t = items.filter(i => i.start_min !== null && i.start_min !== undefined);
      return { iso, day: dd.getDate(), short: WD_SHORT[k], isToday: iso === todayISO(),
        timed: layoutColumns(t, null), untimed: items.filter(i => i.start_min === null || i.start_min === undefined) };
    });
  }
  function buildMonth(baseISO) {
    const weeks = monthMatrix(baseISO);
    const items = {};
    for (const wk of weeks) for (const c of wk)
      items[c.iso] = itemsForDate(tasks, c.iso)
        .sort((a, b) => ((a.start_min ?? 1e9) - (b.start_min ?? 1e9)));
    return { weeks, items };
  }
  // Панель недели (используется и для текущей, и для соседних в карусели).
  function weekPane(wdays) {
    return html`<div class="week-pane">
      <div class="week-head">
        <div class="week-gutter-cell"></div>
        ${wdays.map(wd => html`<button key=${wd.iso}
          class=${"week-day-head" + (wd.iso === todayISO() ? " today" : "")} onClick=${() => openDay(wd.iso)}>
          <span class="week-day-name">${wd.short}</span>
          <span class="week-day-num">${wd.day}</span></button>`)}
      </div>
      ${wdays.some(wd => wd.untimed.length) && html`<div class="week-allday">
        <div class="week-gutter-cell small">весь<br/>день</div>
        ${wdays.map(wd => html`<div class="week-allday-cell" key=${wd.iso}>
          ${wd.untimed.slice(0, 3).map(i => html`<button class="week-chip" key=${i.key}
            style=${`--c:${colorOf(i)};`} onClick=${() => openPreview(i)}>${i.title}</button>`)}
          ${wd.untimed.length > 3 && html`<button class="week-more" onClick=${() => openDay(wd.iso)}>+${wd.untimed.length - 3}</button>`}
        </div>`)}
      </div>`}
      <div class="week-grid" style=${`height:${24 * hourPx}px;`}>
        ${Array.from({ length: 24 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
          <span class="grid-hour-label">${String(h).padStart(2, "0")}:00</span></div>`)}
        ${wdays.map((wd, di) => html`<div class=${"week-col" + (wd.isToday ? " today" : "")} key=${wd.iso}
          style=${`left:calc(${GUTTER}px + (100% - ${GUTTER}px) / 7 * ${di});width:calc((100% - ${GUTTER}px) / 7);`}
          onClick=${() => openDay(wd.iso)}>
          ${wd.isToday && html`<div class="grid-now col" style=${`top:${(nowMin / 60) * hourPx}px;`}><span class="grid-now-dot"></span></div>`}
          ${wd.timed.map(i => {
            const top = (i._start / 60) * hourPx;
            const height = Math.max(16, (i._dur / 60) * hourPx);
            const sub = `100% / ${i._cols}`;
            return html`<button class=${"week-block" + (i.done ? " done" : "")} key=${i.key}
              style=${`top:${top}px;height:${height}px;left:calc((${sub}) * ${i._col});width:calc((${sub}) - 2px);--c:${colorOf(i)};`}
              onClick=${e => { e.stopPropagation(); openPreview(i); }}>
              <span class="week-block-title">${i.title}</span></button>`;
          })}
        </div>`)}
      </div>
    </div>`;
  }
  // Панель месяца.
  function monthPane(m) {
    return html`<div class="month-pane">
      <div class="month-weekdays">
        ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(n => html`<div key=${n}>${n}</div>`)}
      </div>
      <div class="month-weeks">
        ${m.weeks.map((wk, wi) => html`<div class="month-week" key=${wi}>
          ${wk.map(c => {
            const its = m.items[c.iso] || [];
            return html`<div class=${"month-cell" + (c.inMonth ? "" : " out") + (c.iso === date ? " sel" : "")}
              key=${c.iso} onClick=${() => openDay(c.iso)}>
              <div class=${"month-cell-num" + (c.isToday ? " today" : "")}>${c.day}</div>
              <div class="month-cell-items">
                ${its.slice(0, 3).map(i => html`<button class=${"month-chip" + (i.done ? " done" : "")} key=${i.key}
                  style=${`--c:${colorOf(i)};`} onClick=${e => { e.stopPropagation(); openPreview(i); }}>
                  ${(i.start_min !== null && i.start_min !== undefined) ? html`<span class="month-chip-dot"></span>` : ""}
                  <span class="month-chip-title">${i.title}</span></button>`)}
                ${its.length > 3 && html`<div class="month-more">ещё ${its.length - 3}</div>`}
              </div>
            </div>`;
          })}
        </div>`)}
      </div>
    </div>`;
  }
  const weekPrevISO = (() => { const x = fromISO(date); x.setDate(x.getDate() - 7); return toISO(x); })();
  const weekNextISO = (() => { const x = fromISO(date); x.setDate(x.getDate() + 7); return toISO(x); })();
  const monthPrevISO = (() => { const x = fromISO(date); x.setDate(1); x.setMonth(x.getMonth() - 1); return toISO(x); })();
  const monthNextISO = (() => { const x = fromISO(date); x.setDate(1); x.setMonth(x.getMonth() + 1); return toISO(x); })();

  // Подпись текущего фильтра в шапке панели.
  const filterName = filter === "all" ? "Все задачи" : filter === "inbox" ? "Входящие"
    : filter === "done" ? "Завершено" : filter === "trash" ? "Корзина"
    : (filter && filter.startsWith("area:")) ? (areaById[filter.slice(5)]?.name || "Область")
    : (listById[filter]?.name || "Проект");
  const filterColor = filter === "inbox" ? "#64748b"
    : (filter && filter.startsWith("area:")) ? "var(--accent)"
    : (listById[filter]?.color || "var(--accent)");
  const filterIcon = filter === "all" ? Icon.calendar() : filter === "inbox" ? Icon.inbox()
    : filter === "done" ? Icon.check() : filter === "trash" ? Icon.trash()
    : (filter && filter.startsWith("area:")) ? Icon.folder() : Icon.dot();
  const filterList = (filter && listById[filter]) || null;
  // Подсветка строки-цели при перетаскивании (одиночном или переносе выделения).
  const dropHi = (key) => (treeDrag && treeDrag.zone === "section" && treeDrag.dropList === key) || (selDrag && selDrag.dropList === key) || (liftDrag && liftDrag.section === key);
  // Иконка проекта — эмодзи в кружке (цвет проекта тонирует фон). Без эмодзи —
  // маленький кружок в цвете проекта.
  const projTint = (c) => `color-mix(in srgb, ${c || "var(--accent)"} 20%, var(--surface))`;
  const projIconEl = (l) => l && l.emoji
    ? html`<span class="proj-emoji" style=${`background:${projTint(l.color)};`}>${l.emoji}</span>`
    : html`<span class="proj-emoji empty" style=${`--pc:${(l && l.color) || "var(--accent)"};`}></span>`;
  // Проекты без области (или область удалена) показываем отдельной группой снизу.
  const looseProjects = lists.filter(l => !l.area_id || !areaById[l.area_id]);

  // Одна строка задачи в дереве (без даты). Вся строка — «ручка» перетаскивания.
  const taskRowEl = (t, color) => html`
    <div class=${"tree-task" + (t.done ? " done" : "") + (treeDrag && treeDrag.id === t.id ? " dragging" : "")}
      data-treekey=${t.id} key=${t.id} style=${`--c:${color};`} onPointerDown=${e => startTreeDrag(e, t)}>
      ${t.is_event
        ? html`<span class="tree-evmark" style=${`background:${color};`}></span>`
        : html`<button class=${"task-check" + (t.done ? " on" : "")} title="Выполнено"
            style=${t.done ? `background:${color};border-color:${color};` : ""}
            onPointerDown=${e => e.stopPropagation()}
            onClick=${e => { e.stopPropagation(); if (!t.done) popConfetti("tree:" + t.id); toggleDone({ kind: "concrete", id: t.id, done: t.done }); }}>
            ${Icon.check()}${confettiEl("tree:" + t.id, "center")}</button>`}
      <button class="tree-task-body" onClick=${() => { if (trayClickGuard.current) return; setEditing({ task: t, occ: null }); }}>
        <span class="tree-task-title">${t.title}</span></button>
      <button class="btn-mini tree-sched" title="Запланировать на этот день"
        onPointerDown=${e => e.stopPropagation()} onClick=${() => quickSchedule(t)}>${Icon.clock()}</button>
    </div>`;

  // Список задач раздела (третий уровень). target — id проекта, "inbox" или "area:<id>".
  const treeTasksEl = (target, color) => {
    const sub = openTasksOfList(target);
    const dragHere = treeDrag && treeDrag.source === target;
    const others = dragHere ? sub.filter(x => x.id !== treeDrag.id) : sub;
    const rows = others.map(x => ({ ph: false, t: x }));
    if (dragHere && treeDrag.zone === "tree") {
      rows.splice(clamp(treeDrag.overIndex ?? others.length, 0, others.length), 0, { ph: true });
    }
    return html`<div class="tree-tasks" data-listtasks=${target}>
      ${rows.length === 0
        ? html`<div class="tree-empty">Нет задач без даты</div>`
        : rows.map((row, i) => row.ph
          ? html`<div class="tree-ph" data-treekey="__ph__" key="__ph__" style=${`height:${treeDrag.h}px;`}></div>`
          : taskRowEl(row.t, color))}
      <button class="tree-add" onClick=${() => setCreating(
        target === "inbox" ? { list_id: null, area_id: null }
        : (typeof target === "string" && target.indexOf("area:") === 0) ? { list_id: null, area_id: target.slice(5) }
        : { list_id: target, area_id: null })}>
        ${Icon.plus()} Добавить задачу</button>
    </div>`;
  };

  // Строка проекта. Раскрывается третьим уровнем: задачи проекта прямо под названием.
  const projRowEl = (l) => {
    const open = expandedLists.has(l.id);
    return html`
    <div class="proj-row-wrap" key=${l.id}>
      <div class=${"proj-row" + (swipeId === l.id ? " swipe-open" : "")}>
        <div class="proj-row-actions">
          <button class="edit" title="Изменить" onClick=${() => { setListModal(l); setSwipeId(null); }}>${Icon.edit()}</button>
          <button class="del" title="Удалить" onClick=${() => { setDelList(l); setSwipeId(null); }}>${Icon.trash()}</button>
        </div>
        <button class=${"proj-opt" + (open ? " expanded" : "") + (dropHi(l.id) ? " drop-target" : "")}
          data-droplist=${l.id}
          onPointerDown=${e => projSwipe(e, l)} onClick=${() => selectProj(l)}
          onContextMenu=${e => { e.preventDefault(); setSwipeId(null); setCtx({ list: l, x: e.clientX, y: e.clientY }); }}>
          <span class=${"proj-disc" + (open ? " open" : "")}>${Icon.right()}</span>
          ${projIconEl(l)}
          <span class="proj-opt-name">${l.name}</span>
          <span class="proj-opt-count">${countOpen(tasks, l.id)}</span></button>
      </div>
      ${open && treeTasksEl(l.id, l.color || "var(--accent)")}
    </div>`;
  };

  return html`
    <div class="app">
      <div class=${"planner" + (asideOpen ? " aside-open" : "")}>
        <aside class="planner-aside" ref=${asideRef} onTouchStart=${onAsideSwipeStart}>
          <div class="planner-tree">
            <div class="tree-default">
              <button class=${"proj-opt" + (filter === "all" ? " active" : "")} onClick=${() => setFilter("all")}>
                <span class="proj-opt-ico" style="color:var(--accent);">${Icon.calendar()}</span>
                <span class="proj-opt-name">Все задачи</span></button>
              <div class="proj-row-wrap">
                <button class=${"proj-opt" + (expandedLists.has("inbox") ? " expanded" : "") + (dropHi("inbox") ? " drop-target" : "")}
                  data-droplist="inbox" onClick=${() => toggleListExpand("inbox")}>
                  <span class=${"proj-disc" + (expandedLists.has("inbox") ? " open" : "")}>${Icon.right()}</span>
                  <span class="proj-opt-ico" style="color:#64748b;">${Icon.inbox()}</span>
                  <span class="proj-opt-name">Входящие</span>
                  <span class="proj-opt-count">${countOpen(tasks, null)}</span></button>
                ${expandedLists.has("inbox") && treeTasksEl("inbox", "var(--inbox)")}
              </div>
              <button class=${"proj-opt" + (filter === "done" ? " active" : "")} onClick=${() => setFilter("done")}>
                <span class="proj-opt-ico" style="color:#16a34a;">${Icon.check()}</span>
                <span class="proj-opt-name">Завершено</span></button>
              <button class=${"proj-opt" + (filter === "trash" ? " active" : "")} onClick=${() => setFilter("trash")}>
                <span class="proj-opt-ico" style="color:#94a3b8;">${Icon.trash()}</span>
                <span class="proj-opt-name">Корзина</span>
                <span class="proj-opt-count">${trashTasks.length || ""}</span></button>
            </div>

            <div class="tree-sep">Области и проекты</div>

            ${areasSorted.map(a => html`
              <div class="area-group" key=${a.id}>
                <div class="area-head">
                  <button class="area-toggle" title=${areaCollapsed.has(a.id) ? "Развернуть" : "Свернуть"}
                    onClick=${() => toggleArea(a.id)}>
                    <span class=${"area-chev" + (areaCollapsed.has(a.id) ? "" : " open")}>${Icon.right()}</span></button>
                  <button class=${"proj-opt area-opt" + (dropHi("area:" + a.id) ? " drop-target" : "")}
                    data-droplist=${"area:" + a.id}
                    onClick=${() => toggleArea(a.id)}
                    onContextMenu=${e => { e.preventDefault(); setCtx({ area: a, x: e.clientX, y: e.clientY }); }}>
                    <span class="proj-opt-ico" style="color:var(--accent);">${Icon.folder()}</span>
                    <span class="proj-opt-name">${a.name}</span>
                    <span class="proj-opt-count">${countArea(tasks, a.id, areaOfList)}</span></button>
                  <div class="area-actions">
                    <button class="edit" title="Изменить" onClick=${() => setAreaModal(a)}>${Icon.edit()}</button>
                    <button class="del" title="Удалить" onClick=${() => setDelArea(a)}>${Icon.trash()}</button>
                  </div>
                </div>
                ${!areaCollapsed.has(a.id) && html`<div class="area-projects">
                  ${openTasksOfList("area:" + a.id).length > 0 && treeTasksEl("area:" + a.id, "var(--accent)")}
                  ${lists.filter(l => l.area_id === a.id).map(projRowEl)}
                  <button class="proj-opt proj-opt-new sm" onClick=${() => setListModal({ area_id: a.id })}>
                    <span class="proj-opt-ico">${Icon.plus()}</span>
                    <span class="proj-opt-name">Проект в области</span></button>
                </div>`}
              </div>`)}

            ${looseProjects.length > 0 && areasSorted.length > 0 && html`<div class="proj-sep">Проекты</div>`}
            ${looseProjects.map(projRowEl)}

            <button class="proj-opt proj-opt-new" onClick=${() => setListModal("new")}>
              <span class="proj-opt-ico">${Icon.plus()}</span>
              <span class="proj-opt-name">Новый проект</span></button>
            <button class="proj-opt proj-opt-new" onClick=${() => setAreaModal("new")}>
              <span class="proj-opt-ico">${Icon.folder()}</span>
              <span class="proj-opt-name">Новая область</span></button>
          </div>
        </aside>

        <div class="planner-content" ref=${contentRef}>
          <div class="planner-head">
            <div class="planner-nav">
              ${special
                ? html`<span class="planner-date-main">${filterName}</span>`
                : html`
                  <button class="icon-btn cal-btn" title="Выбрать дату"
                    onClick=${() => { const el = dateInputRef.current; el?.showPicker ? el.showPicker() : el?.focus(); }}>
                    ${Icon.calendar()}
                    <input class="planner-date-input" type="date" ref=${dateInputRef} value=${date}
                      onInput=${e => e.target.value && setDate(e.target.value)} />
                  </button>
                  ${view !== "day" ? html`<span class="planner-date-main">${headLabel}</span>` : ""}`}
            </div>
            <div class="planner-head-actions">
              ${filter === "trash" && trashTasks.length > 0 && html`<button class="btn sm ghost" onClick=${() => setEmptyTrash(true)}>Очистить</button>`}
              ${!special && html`<button class=${"btn sm ghost" + (isToday ? " hidden-keep" : "")} onClick=${() => setDate(todayISO())}>Сегодня</button>`}
              ${!special && html`<button class="btn sm ghost view-cycle" title="Сменить режим"
                onClick=${() => { const i = VIEWS.findIndex(([v]) => v === view); setView(VIEWS[(i + 1) % VIEWS.length][0]); }}>
                ${(VIEWS.find(([v]) => v === view) || VIEWS[0])[1]}</button>`}
              ${!special && html`<button class="icon-btn" title="Новая задача" onClick=${() => setCreating(newTaskTarget())}>${Icon.plus()}</button>`}
              <button class="icon-btn" title="Поиск" onClick=${() => setSearchOpen(true)}>${Icon.search()}</button>
              <button class="icon-btn" title="Настройки" onClick=${() => setSettingsOpen(true)}>${Icon.gear()}</button>
            </div>
          </div>

          ${special && html`<div class="special-list">
            ${(filter === "done" ? doneTasks : trashTasks).length === 0
              ? html`<div class="special-empty">${filter === "done" ? "Пока нет завершённых задач." : "Корзина пуста."}</div>`
              : (filter === "done" ? doneTasks : trashTasks).map(t => html`
                <div class=${"special-item" + (filter === "done" ? " done" : "")} key=${t.id}>
                  ${filter === "done"
                    ? html`<button class="task-check on" title="Вернуть в активные"
                        style=${`background:${listById[t.list_id]?.color || "var(--accent)"};border-color:${listById[t.list_id]?.color || "var(--accent)"};`}
                        onClick=${() => toggleDone({ kind: "concrete", id: t.id, done: t.done })}>${Icon.check()}</button>`
                    : html`<button class="icon-btn sm" title="Восстановить"
                        onClick=${() => { store.actions.tasks.restore(t.id).catch(showErr); store.pushToast("Задача восстановлена", "success"); }}>${Icon.restore()}</button>`}
                  <button class="special-body" onClick=${() => { if (filter === "done") setEditing({ task: t, occ: null }); }}>
                    <span class="special-title">${t.title}</span>
                    <span class="special-meta">
                      ${t.list_id ? html`<span style=${`color:${listById[t.list_id]?.color};`}>${listById[t.list_id]?.name} · </span>`
                        : t.area_id ? html`<span style="color:var(--accent);">${areaById[t.area_id]?.name || "Область"} · </span>` : ""}${taskMeta(t)}</span>
                  </button>
                  ${filter === "trash" && html`<button class="icon-btn sm danger" title="Удалить навсегда"
                    onClick=${() => { store.actions.tasks.purge(t.id).catch(showErr); store.pushToast("Удалено навсегда", "success"); }}>${Icon.trash()}</button>`}
                </div>`)}
          </div>`}

          ${!special && view === "day" && html`<div class="planner-week">
            ${week.map(w => html`<button key=${w.iso}
              class=${"wday" + (w.iso === (pendingDate || date) ? " active" : "") + (w.iso === todayISO() ? " today" : "")}
              onClick=${() => setDate(w.iso)}>
              <span class="wday-num">${w.day}</span><span class="wday-name">${w.short}</span></button>`)}
          </div>`}

          ${!special && view === "day" && html`<div class="planner-body">
            ${store.loading && tasks.length === 0 ? html`<div class="grid-loading"><div class="boot-spinner"></div></div>` : ""}
            <div class="planner-grid-scroll" ref=${scrollRef} onTouchStart=${onDaySwipeStart}>
              <div class="tl-track" ref=${trackRef}>
                <div class="tl-pane">${peek ? dayPeekPane(prevDate) : null}</div>
                <div class="tl-pane">
              <div class=${"allday" + (allDay.length === 0 ? " empty" : "") + (allDay.length ? " grid" : "") + ((dnd && dnd.zone === "allday") || (liftDrag && liftDrag.allday) || (treeDrag && treeDrag.zone === "allday") || (selDrag && selDrag.dropList === "__allday__") ? " drop" : "")} ref=${adGridRef} style=${`--adh:${adH}px`}
                onPointerDown=${e => { if (e.shiftKey && !(e.target.closest && e.target.closest(".allday-item"))) startRangeSelect(e); }}>
                ${(() => {
                  const cell = (i) => html`
                    <div class=${"allday-item" + (i.done ? " done" : "") + (selected.has(i.key) ? " sel" : "") + (treeDrag && treeDrag.key === i.key ? " is-dragging" : "")} key=${i.key} data-adkey=${i.key}
                      style=${`--c:${colorOf(i)};`}
                      onPointerDown=${e => { if (i.id) startTreeDrag(e, i, true); }}
                      onClick=${e => { if (trayClickGuard.current) return; handleTap(i, e.shiftKey); }}>
                      ${i.is_event
                        ? html`<span class="allday-evmark" style=${`background:${colorOf(i)};`}></span>`
                        : html`<button class=${"allday-check" + (i.done ? " on" : "")} type="button" title="Выполнено"
                            style=${`border-color:${colorOf(i)};color:${colorOf(i)};`}
                            onPointerDown=${e => e.stopPropagation()}
                            onClick=${e => { e.stopPropagation(); if (trayClickGuard.current) return; if (!i.done) popConfetti("ad:" + i.key); toggleDone(i); }}>${Icon.check()}${confettiEl("ad:" + i.key, "center")}</button>`}
                      <span class="allday-title">${i.title}</span>
                    </div>`;
                  // Во время перестановки внутри «весь день» переставляем капсулы вживую
                  // (перетаскиваемая остаётся в потоке, но невидима) — соседи плавно
                  // расступаются за счёт FLIP-анимации.
                  if (treeDrag && treeDrag.zone === "allday" && treeDrag.adIndex != null) {
                    const di = allDay.findIndex(x => x.key === treeDrag.key);
                    if (di >= 0) {
                      const rest = allDay.filter((_, k) => k !== di);
                      rest.splice(clamp(treeDrag.adIndex, 0, rest.length), 0, allDay[di]);
                      return rest.map(cell);
                    }
                  }
                  return allDay.map(cell);
                })()}
              </div>
              <div class="allday-handle" onPointerDown=${onAllDayHandleDown} onTouchStart=${e => e.stopPropagation()}><span class="allday-grip"></span></div>
              <div class=${"tl" + (drag ? " busy" : "")} ref=${innerRef} onPointerDown=${onGridPointerDown} style=${`height:${24 * hourPx}px;`}>
                ${Array.from({ length: 25 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
                  <span class=${"grid-hour-label" + (h === 24 ? " last" : "")}>${(h % 24 === 0 ? "00" : String(h).padStart(2, "0"))}:00</span></div>`)}
                <div class="tl-spine"></div>
                ${isToday && html`<div class="grid-now" style=${`top:${(nowMin / 60) * hourPx}px;`}>
                  <span class="grid-now-time">${minToHHMM(nowMin)}</span><span class="grid-now-dot"></span></div>`}
                ${edGridMin != null && html`<div class="ed-anchor" style=${`top:${(edGridMin / 60) * hourPx}px;`}>${editorEl}</div>`}
                ${dayTl.map(i => {
                  // Переходящая через полночь задача рисуется сегментом дня и не
                  // перетаскивается/не тянется (правка — через карточку по тапу).
                  const spanning = i.spanTop || i.spanBottom || i.cont;
                  let vTop = i.vTop, vDur = i.vEnd - i.vTop;
                  const inGroupMove = drag && drag.type === "moveGroup" && drag.keys.includes(i.key);
                  const isKeyMove = drag && drag.key === i.key && (drag.type === "move" || drag.type === "resize");
                  if (inGroupMove) vTop = clamp(i.start_min + drag.delta, 0, 1440 - vDur);
                  else if (isKeyMove) { vTop = drag.start; vDur = drag.dur; }
                  const dragging = inGroupMove || isKeyMove;
                  const sel = selected.has(i.key);
                  const top = (vTop / 60) * hourPx;
                  const height = Math.max(MIN_EVENT_PX, (vDur / 60) * hourPx);
                  // Высота зоны-ресайза (десктоп): тонкая (≤8px, у самого края) и не больше
                  // ~трети блока, чтобы в середине всегда оставалось место «взять и перенести»
                  // даже у тонких блоков. На мобильном — как в CSS (не трогаем).
                  const handleStyle = isMobile ? "" : `height:${Math.max(0, Math.min(8, (height - 12) / 2))}px`;
                  const density = height >= 44 ? "" : height >= 24 ? " compact" : " mini";
                  // Колонки при пересечении: задача занимает свою долю ширины и сдвигается
                  // вправо. При переносе/растягивании одной задачи её слот живой (обтекает
                  // соседей). Групповой перенос и переходящая через полночь — на всю ширину.
                  const slot = dayCols.get(i.key);
                  // Спан (через полночь) — во всю ширину. Иначе задача занимает свою долю
                  // ширины при пересечении с соседями.
                  const cols = (spanning || !slot) ? 1 : slot.cols;
                  const colStyle = cols > 1 ? `--cols:${cols};--col:${slot.col};` : "";
                  const down = spanning ? (e => e.stopPropagation()) : (e => onBlockPointerDown(e, i));
                  const tap = spanning ? (e => { e.stopPropagation(); openPreview(i); }) : null;
                  // Поднятую задачу рисуем плавающей копией поверх (см. ниже). Сам элемент в
                  // ленте НЕ удаляем (иначе iOS шлёт pointercancel → перенос срывается) — прячем
                  // через visibility:hidden, место и касание сохраняются.
                  const hiddenLift = liftDrag && !liftDrag.done && i.key === liftDrag.key;
                  const isEv = i.is_event;
                  const evCls = isEv ? " tl-ev tl-bar-" + (i.card_bar || "none") + " tl-bg-" + (i.card_bg || "clean") : "";
                  const waveVar = (isEv && (i.card_bg === "waves" || i.card_bg === "waves2")) ? "--wave:" + waveDataUrl(colorOf(i), i.card_bg) + ";" : "";
                  return html`<div class=${"tl-event" + density + evCls + (cols > 1 ? " columned" : "") + (i.done ? " done" : "") + (dragging ? " dragging" : "") + (sel ? " sel" : "") + (hiddenLift ? " lift-hidden" : "") + (i.spanTop ? " span-top" : "") + (i.spanBottom ? " span-bottom" : "") + (openSubs.has(i.key) ? " subs-open" : "")} key=${i.key} data-key=${i.key}
                    style=${`top:${top}px;height:${height}px;--c:${colorOf(i)};${colStyle}${waveVar}`}
                    onPointerDown=${down}
                    onContextMenu=${e => { e.preventDefault(); e.stopPropagation(); openPreview(i); }}>
                    ${isEv && i.card_bar && i.card_bar !== "none" && html`<div class=${"tl-evbar " + i.card_bar}></div>`}
                    <div class="tl-pill" onPointerDown=${down} onClick=${tap}>
                      ${!isEv && html`<button class=${"tl-pill-check" + (i.done ? " on" : "") + (fallKey === i.key ? " falling" : "")} type="button" title="Выполнено"
                        style=${`--drop:${Math.max(0, height - 34)}px;`}
                        onPointerDown=${e => e.stopPropagation()}
                        onClick=${e => { e.stopPropagation(); completeToggle(i); }}>${Icon.check()}</button>`}
                      ${!isEv && confettiEl(i.key)}
                      ${sel && !spanning && html`<div class="tl-dot top" onPointerDown=${e => onResizeTopPointerDown(e, i)}></div>`}
                      ${sel && !spanning && html`<div class="tl-dot bottom" onPointerDown=${e => onResizePointerDown(e, i)}></div>`}
                    </div>
                    ${!spanning && html`<div class="tl-handle top" style=${handleStyle} onPointerDown=${e => onResizeTopPointerDown(e, i)}></div>`}
                    ${!spanning && html`<div class="tl-handle bottom" style=${handleStyle} onPointerDown=${e => onResizePointerDown(e, i)}></div>`}
                    <div class="tl-body">
                      <div class="tl-text">
                        <div class="tl-titlerow">
                          <div class="tl-title"
                            onClick=${e => { if (spanning) { e.stopPropagation(); openPreview(i); } }}>${i.title}${i.recurring ? html` <span class="tl-rep">${Icon.repeat()}</span>` : ""}</div>
                        </div>
                        <div class="tl-meta">${minRangeLabel(dragging ? vTop : i.start_min, dragging ? vDur : (i.duration_min || 0))} (${durHuman(dragging ? vDur : (i.duration_min || 0))})</div>
                        ${(i.subtasks && i.subtasks.length && !spanning) ? html`
                          <div class="tl-subs" onPointerDown=${e => e.stopPropagation()}>
                            <button class=${"tl-subs-chip" + (openSubs.has(i.key) ? " open" : "")} type="button"
                              onClick=${e => { e.stopPropagation(); toggleSubs(i.key); }}>
                              <span class="tl-subs-box">${Icon.check()}</span>
                              <span class="tl-subs-count">${i.subtasks.filter(s => s.done).length}/${i.subtasks.length}</span>
                              <span class="tl-subs-chev">${Icon.right()}</span>
                            </button>
                            <div class=${"tl-subs-wrap" + (openSubs.has(i.key) ? " open" : "")}>
                              <div class="tl-subs-list">
                                ${i.subtasks.map(s => html`
                                  <div class=${"tl-subs-item" + (s.done ? " done" : "")} key=${s.id}>
                                    <button class=${"task-check sm" + (s.done ? " on" : "")} type="button"
                                      style=${`border-color:${colorOf(i)};${s.done ? `background:${colorOf(i)};` : ""}`}
                                      onClick=${e => { e.stopPropagation(); if (!s.done) popConfetti("sub:" + i.key + s.id); store.actions.tasks.toggleSub(i.recurring ? i.templateId : i.id, s.id).catch(showErr); }}>${Icon.check()}${confettiEl("sub:" + i.key + s.id, "center")}</button>
                                    ${subEdit && subEdit.key === i.key && subEdit.subId === s.id
                                      ? html`<input class="tl-subs-edit" ref=${focusEnd} value=${subEdit.value}
                                          onInput=${e => setSubEdit({ key: i.key, subId: s.id, value: e.target.value })}
                                          onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); commitSubEdit(i); } else if (e.key === "Escape") { e.preventDefault(); setSubEdit(null); } }}
                                          onBlur=${() => commitSubEdit(i)} />`
                                      : html`<span class="tl-subs-title" onClick=${e => { e.stopPropagation(); startSubEdit(i, s); }}>${s.title}</span>`}
                                  </div>`)}
                              </div>
                            </div>
                          </div>` : ""}
                      </div>
                    </div>
                  </div>`;
                })}
                ${drag && drag.type === "copy" && (() => {
                  const src = dayTl.find(x => x.key === drag.key);
                  return html`<div class="tl-ghost" style=${`top:${(drag.start / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, (drag.dur / 60) * hourPx)}px;--c:${src ? colorOf(src) : "var(--accent)"};`}>
                    <div class="tl-ghost-pill"></div>
                    <div class="tl-ghost-label">${minRangeLabel(drag.start, drag.dur)} (${durHuman(drag.dur)})</div></div>`;
                })()}
                ${drag && drag.type === "copyGroup" && drag.keys.map(k => {
                  const it = dayTl.find(x => x.key === k);
                  if (!it) return null;
                  const ns = clamp(it.start_min + drag.delta, 0, 1440 - (it.duration_min || 0));
                  return html`<div class="tl-ghost" key=${"cg" + k} style=${`top:${(ns / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, ((it.duration_min || 0) / 60) * hourPx)}px;--c:${colorOf(it)};`}>
                    <div class="tl-ghost-pill"></div></div>`;
                })}
                ${drag && drag.type === "create" && drag.dur > 0 && html`<div class="tl-ghost placing"
                  style=${`top:${(drag.start / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, (drag.dur / 60) * hourPx)}px;`}>
                  <div class="tl-ghost-pill"></div>
                  <div class="tl-ghost-label">${minRangeLabel(drag.start, drag.dur)} (${durHuman(drag.dur)})</div></div>`}
              </div>
              </div>
              <div class="tl-pane">${peek ? dayPeekPane(nextDate) : null}</div>
              </div>
            </div>
          </div>`}

          ${!special && view === "week" && html`<div class="week-scroll" ref=${weekScrollRef} onTouchStart=${onCarouselSwipeStart}>
            <div class="tl-track" ref=${trackRef}>
              <div class="tl-pane">${peek ? weekPane(buildWeekDays(weekPrevISO)) : null}</div>
              <div class="tl-pane">${weekPane(weekDays)}</div>
              <div class="tl-pane">${peek ? weekPane(buildWeekDays(weekNextISO)) : null}</div>
            </div>
          </div>`}

          ${!special && view === "month" && html`<div class="month" ref=${monthRef} onTouchStart=${onCarouselSwipeStart}>
            <div class="tl-track" ref=${trackRef}>
              <div class="tl-pane">${peek ? monthPane(buildMonth(monthPrevISO)) : null}</div>
              <div class="tl-pane">${monthPane({ weeks: monthWeeks, items: monthItems })}</div>
              <div class="tl-pane">${peek ? monthPane(buildMonth(monthNextISO)) : null}</div>
            </div>
          </div>`}
        </div>
      </div>
    </div>

    ${dnd && dnd.zone !== "grid" && html`<div class="dnd-ghost" style=${`left:${dnd.x}px;top:${dnd.y}px;--c:${dnd.color};`}>
      <span class="dnd-ghost-dot"></span>${dnd.title}
      ${dnd.zone === "tray" ? html`<span class="dnd-ghost-hint">${dnd.source === "grid" ? "убрать из дня" : "снять время"}</span>` : ""}
    </div>`}
    ${dnd && dnd.source === "tray" && dnd.zone === "grid" && dndGeomRef.current && (() => {
      // Перенос из «весь день» в сетку — тот же вид, что и подъём обычной задачи:
      // капсула свободно едет под пальцем (2D), а призрак времени привязан к разметке (см. выше).
      const g = dndGeomRef.current, h = Math.max(MIN_EVENT_PX, (dnd.dur / 60) * hourPx);
      return html`<div class="tl-event tl-lift-overlay lifted" style=${`top:${dnd.y - h / 2}px;left:${g.left + (dnd.x - g.startX)}px;width:${g.width}px;height:${h}px;--c:${dnd.color};transform:scale(1.04);`}>
        <div class="tl-pill"></div>
        <div class="tl-body"><div class="tl-text">
          <div class="tl-titlerow"><div class="tl-title">${dnd.title}</div></div>
          <div class="tl-meta">${minRangeLabel(dnd.gridMin, dnd.dur)} (${durHuman(dnd.dur)})</div>
        </div></div>
      </div>`;
    })()}
    ${ctx && html`<div class="ctx-back" onPointerDown=${() => setCtx(null)} onContextMenu=${e => { e.preventDefault(); setCtx(null); }}>
      <div class="ctx-menu" style=${`left:${Math.min(ctx.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 176)}px;top:${ctx.y}px;`} onPointerDown=${e => e.stopPropagation()}>
        ${ctx.area
          ? html`
            <button class="ctx-item" onClick=${() => { setAreaModal(ctx.area); setCtx(null); setProjOpen(false); }}>${Icon.edit()} Изменить</button>
            <button class="ctx-item danger" onClick=${() => { setDelArea(ctx.area); setCtx(null); setProjOpen(false); }}>${Icon.trash()} Удалить</button>`
          : html`
            <button class="ctx-item" onClick=${() => { setListModal(ctx.list); setCtx(null); setProjOpen(false); }}>${Icon.edit()} Изменить</button>
            <button class="ctx-item danger" onClick=${() => { setDelList(ctx.list); setCtx(null); setProjOpen(false); }}>${Icon.trash()} Удалить</button>`}
      </div>
    </div>`}
    ${settingsOpen && html`<${SettingsModal} onClose=${() => setSettingsOpen(false)} />`}
    ${searchOpen && html`<${SearchModal} onClose=${() => setSearchOpen(false)}
      onPick=${t => { setSearchOpen(false); if (t.date) { setDate(t.date); setView("day"); } setEditing({ task: t, occ: null }); }} />`}
    ${liftDrag && !liftDrag.done && !(liftDrag.allday && liftDrag.cx != null) && liftItemRef.current && liftGeomRef.current && (() => {
      // Плавающая копия поднятой задачи (fixed, поверх всего) — едет за пальцем и не
      // уезжает с лентой, пока второй палец листает дни. Доезжает на место и сменяется
      // настоящей задачей в сетке (кадр .done).
      const it = liftItemRef.current, g = liftGeomRef.current, landing = liftDrag.landing;
      const dur = it.duration_min || 0;
      const liftMin = clamp(snap(it.start_min + Math.round((liftDrag.dy / hourPx) * 60)), 0, 1440 - dur);
      const density = g.height >= 44 ? "" : g.height >= 24 ? " compact" : " mini";
      const isEv = it.is_event;
      const evCls = isEv ? " tl-ev tl-bar-" + (it.card_bar || "none") + " tl-bg-" + (it.card_bg || "clean") : "";
      const waveVar = (isEv && (it.card_bg === "waves" || it.card_bg === "waves2")) ? "--wave:" + waveDataUrl(colorOf(it), it.card_bg) + ";" : "";
      return html`<div class=${"tl-event tl-lift-overlay" + evCls + density + (it.done ? " done" : "") + (landing ? " landing" : " lifted")}
        style=${`top:${g.top}px;left:${g.left}px;width:${g.width}px;height:${g.height}px;--c:${colorOf(it)};${waveVar}transform:translate(${liftDrag.dx}px,${liftDrag.dy}px)${landing ? "" : " scale(1.04)"};`}>
        ${isEv && it.card_bar && it.card_bar !== "none" && html`<div class=${"tl-evbar " + it.card_bar}></div>`}
        <div class="tl-pill">${!isEv ? html`<button class=${"tl-pill-check" + (it.done ? " on" : "")} type="button">${Icon.check()}</button>` : ""}</div>
        <div class="tl-body"><div class="tl-text">
          <div class="tl-titlerow"><div class="tl-title">${it.title}${it.recurring ? html` <span class="tl-rep">${Icon.repeat()}</span>` : ""}</div></div>
          <div class="tl-meta">${minRangeLabel(liftMin, dur)} (${durHuman(dur)})</div>
        </div></div>
      </div>`;
    })()}
    ${liftDrag && !liftDrag.done && liftDrag.allday && liftDrag.cx != null && liftItemRef.current && (() => {
      // Над зоной «весь день» (десктоп) копия ужимается до капсулы — точно такой же,
      // как задачи «весь день», и едет у курсора. Подсветки всей зоны нет.
      const it = liftItemRef.current;
      return html`<div class="allday-item sel ad-lift" style=${`position:fixed;left:${liftDrag.cx + 12}px;top:${liftDrag.cy + 10}px;z-index:80;pointer-events:none;width:max-content;max-width:220px;--c:${colorOf(it)};`}>
        ${it.is_event
          ? html`<span class="allday-evmark" style=${`background:${colorOf(it)};`}></span>`
          : html`<span class=${"allday-check" + (it.done ? " on" : "")} style=${`border-color:${colorOf(it)};color:${colorOf(it)};`}>${Icon.check()}</span>`}
        <span class="allday-title">${it.title}</span>
      </div>`;
    })()}
    ${treeDrag && html`<div class=${"tree-drag-card" + (treeDrag.landing ? " landing" : "") + (treeDrag.dropping ? " dropping" : "")}
      style=${treeDrag.landing
        ? `left:${treeDrag.landX}px;top:${treeDrag.landY}px;width:${treeDrag.landW}px;height:${treeDrag.landH}px;--c:${treeDrag.color};`
        : `left:${treeDrag.x - treeDrag.offX}px;top:${treeDrag.y - treeDrag.offY}px;width:${treeDrag.w}px;height:${treeDrag.h}px;--c:${treeDrag.color};`}>
      ${treeDrag.isEvent
        ? html`<span class="tree-evmark" style=${`background:${treeDrag.color};`}></span>`
        : html`<span class="task-check"></span>`}
      <span class="tree-task-title">${treeDrag.title}</span>
    </div>`}
    <input ref=${kbPrimerRef} class="kb-primer" type="text" inputmode="text" />
    ${selRange && html`<div class="tl-marquee" style=${`left:${selRange.x}px;top:${selRange.y}px;width:${selRange.w}px;height:${selRange.h}px;`}></div>`}
    ${selDrag && html`<div class=${"sel-drag-card" + (selDrag.dropList ? " over" : "")} style=${`left:${selDrag.x + 14}px;top:${selDrag.y + 10}px;`}>
      <span class="sel-drag-count">${selDrag.count}</span>
      <span class="sel-drag-label">${selDrag.count === 1 ? "задача" : (selDrag.count < 5 ? "задачи" : "задач")}</span>
    </div>`}
    ${edFloat && html`<div ref=${edBackRef} class=${"ed-float-back" + (edClosing ? " closing" : "") + (edAnchorMobile ? " anchored" : "")} onPointerDown=${e => { if (e.target === e.currentTarget) closeEditor(); }}>${editorEl}</div>`}
    ${listModal && html`<${ListForm}
      initial=${(listModal !== "new" && listModal.id) ? listModal : null}
      defaultArea=${listModal !== "new" && !listModal.id ? listModal.area_id : null}
      onDelete=${(listModal !== "new" && listModal.id) ? () => { setDelList(listModal); setListModal(null); } : null}
      onClose=${() => setListModal(null)} />`}
    ${delList && html`<${MoveTasksModal} list=${delList} lists=${lists}
      taskCount=${tasks.filter(t => t.list_id === delList.id && !t.deleted_at).length}
      onCancel=${() => setDelList(null)}
      onConfirm=${async (moveTo) => { const id = delList.id; setDelList(null);
        await store.actions.taskLists.remove(id, moveTo);
        if (filter === id) setFilter(moveTo || "all"); store.pushToast("Проект удалён", "success"); }} />`}
    ${areaModal && html`<${AreaForm} initial=${areaModal === "new" ? null : areaModal}
      onClose=${() => setAreaModal(null)} />`}
    ${delArea && html`<${ConfirmModal} title="Удалить область?"
      message="Проекты внутри останутся (станут «без области»), а задачи прямо из области переедут во «Входящие». Ничего не пропадёт."
      onCancel=${() => setDelArea(null)}
      onConfirm=${async () => { const id = delArea.id; setDelArea(null);
        await store.actions.areas.remove(id);
        if (filter === "area:" + id) setFilter("all"); store.pushToast("Область удалена", "success"); }} />`}
    ${emptyTrash && html`<${ConfirmModal} title="Очистить корзину?"
      message="Все задачи из корзины будут удалены навсегда, без возможности восстановления."
      onCancel=${() => setEmptyTrash(false)}
      onConfirm=${async () => { setEmptyTrash(false); await store.actions.tasks.emptyTrash(); store.pushToast("Корзина очищена", "success"); }} />`}
  `;
}

function layoutColumns(items, drag) {
  const eff = items.map(i => drag && drag.key === i.key
    ? { ...i, _start: drag.start, _dur: drag.dur }
    : { ...i, _start: i.vTop, _dur: i.vEnd - i.vTop });
  const sorted = eff.sort((a, b) => (a._start - b._start) || (a._dur - b._dur));
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const colEnds = [];
    cluster.forEach(it => {
      let c = colEnds.findIndex(end => end <= it._start);
      if (c === -1) { c = colEnds.length; colEnds.push(0); }
      colEnds[c] = it._start + it._dur; it._col = c;
    });
    cluster.forEach(it => { it._cols = colEnds.length; });
    cluster = []; clusterEnd = -1;
  };
  sorted.forEach(it => {
    if (cluster.length && it._start >= clusterEnd) flush();
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it._start + it._dur);
  });
  flush();
  return sorted;
}

// Счётчик = задачи без даты (именно они показаны в боковом списке; задачи с датой
// живут в сетке дня и здесь не считаются).
function countOpen(tasks, listId) {
  const n = tasks.filter(t => !t.recurrence_parent && !t.done && !t.deleted_at && !t.date
    && (listId ? t.list_id === listId : (!t.list_id && !t.area_id))).length;
  return n || "";
}
function countArea(tasks, areaId, areaOfList) {
  const n = tasks.filter(t => !t.recurrence_parent && !t.done && !t.deleted_at && !t.date
    && (t.area_id === areaId || (t.list_id && areaOfList(t.list_id) === areaId))).length;
  return n || "";
}
