import { html } from "htm/preact";
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "preact/hooks";
import { useStore } from "./store.js";
import {
  Icon, todayISO, toISO, fromISO, monthGen, monthNom, relLabel,
  minRangeLabel, minToHHMM, itemsForDate, matchesFilter,
  monthMatrix, weekRangeLabel, weekStart,
  durHuman, doneFeedback, haptic,
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

const ALLDAY_COLS = 3;
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
  const [adDrag, setAdDrag] = useState(null); // перетаскивание-перестановка в зоне «весь день»
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
  const adChipRef = useRef(null);   // плавающая карточка при перестановке
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
    const onDown = (e) => { const t = e.target; if (!(t && t.closest && t.closest(".tl-event"))) setSelected(new Set()); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selected]);
  useEffect(() => { hourPxRef.current = hourPx; try { localStorage.setItem("planner.hourPx", String(hourPx)); } catch (e) {} }, [hourPx]);
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
      const now = performance.now();
      const gap = now - lastInputT;
      // Новый жест поверх анимации (большой gap от прошлого ввода) — отменяем доезд
      // и начинаем драгать с того места, где была анимация.
      if (animating && gap > 130) cancelAnim();
      lastInputT = now;
      const w = el.clientWidth;
      dx = Math.max(-w, Math.min(w, dx - e.deltaX));
      apply();
      clearTimeout(endTimer);
      // ~80мс после последнего события (инерция тачпада тоже сюда падает) → snap.
      endTimer = setTimeout(triggerSnap, 80);
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

  const dayItems = useMemo(() => itemsForDate(tasks, date).filter(i => matches(i)), [tasks, date, filter, taskLists]);
  const timed = dayItems.filter(i => i.start_min !== null && i.start_min !== undefined);
  // Порядок задач «весь день» задаётся sort_order строки; на drag перезаписываем его.
  const sortOrderById = useMemo(() => {
    const m = new Map();
    for (const t of tasks) m.set(t.id, t.sort_order ?? 0);
    return m;
  }, [tasks]);
  const rowIdOf = (i) => (i.kind === "occurrence" ? i.templateId : i.id);
  // Задачи этого дня без времени — показываем в зоне «весь день» над сеткой.
  const allDay = dayItems
    .filter(i => i.start_min === null || i.start_min === undefined)
    .sort((a, b) => ((sortOrderById.get(rowIdOf(a)) ?? 0) - (sortOrderById.get(rowIdOf(b)) ?? 0))
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const allDayIds = new Set(allDay.map(i => (i.kind === "occurrence" ? i.templateId : i.id)));
  // id задач, уже стоящих блоком в сетке текущего дня (одиночные — по id,
  // повторяющиеся — по id шаблона). Их не показываем в боковой панели.
  const gridIds = new Set(timed.map(i => (i.kind === "occurrence" ? i.templateId : i.id)));
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
  const trayTasks = projTasks.filter(t => !gridIds.has(t.id) && !allDayIds.has(t.id));

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
      map[c.iso] = itemsForDate(tasks, c.iso).filter(i => matches(i))
        .sort((a, b) => {
          const at = a.start_min ?? 1e9, bt = b.start_min ?? 1e9;
          return at - bt;
        });
    }
    return map;
  }, [view, monthWeeks, tasks, filter, taskLists]);

  const weekDays = useMemo(() => {
    if (view !== "week") return null;
    const mon = weekStart(date);
    const WD = WD_SHORT;
    return Array.from({ length: 7 }, (_, k) => {
      const dd = new Date(mon); dd.setDate(mon.getDate() + k);
      const iso = toISO(dd);
      const items = itemsForDate(tasks, iso).filter(i => matches(i));
      const t = items.filter(i => i.start_min !== null && i.start_min !== undefined);
      return {
        iso, day: dd.getDate(), short: WD[k], isToday: iso === todayISO(),
        timed: layoutColumns(t, null),
        untimed: items.filter(i => i.start_min === null || i.start_min === undefined),
      };
    });
  }, [view, date, tasks, filter, taskLists]);

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
  }, [allDay.map(i => i.key).join(",") + "|" + (adDrag ? adDrag.key + ":" + adDrag.overIndex : ""), view]);
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

  function startRangeSelect(e) {
    e.preventDefault();
    const anchor = clamp(yToMin(e.clientY), 0, 1440);
    const base = new Set(selected);
    const apply = (cur) => {
      const lo = Math.min(anchor, cur), hi = Math.max(anchor, cur);
      const n = new Set(base);
      for (const it of dayTl) {
        const s = it.start_min, en = s + (it.duration_min || 0);
        if (s < hi && en > lo) n.add(it.key);
      }
      setSelected(n);
      setSelRange({ lo, hi });
    };
    const move = ev => { ev.preventDefault(); apply(clamp(yToMin(ev.clientY), 0, 1440)); };
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); setSelRange(null); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    apply(anchor);
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
    const items = dayTl.filter(i => selected.has(i.key));
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
      setLiftDrag({ key: item.key, dx: ev.clientX - sx, dy: ev.clientY - sy, landing: false, allday: overAllday });
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
    let newStart = item.start_min, moved = false, delta = 0;
    const move = ev => {
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 4) moved = true;
      if (!moved) return;
      if (group) {
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
    const cancel = () => { detach(); setDrag(null); setDnd(null); };
    const up = (ev) => {
      detach();
      setDrag(null); setDnd(null);
      if (!moved) { (tapAction || (() => handleTap(item, shift)))(); return; }
      if (copy) {
        const list = group ? group : [{ item, start: item.start_min, dur: item.duration_min || 0 }];
        const off = group ? delta : (newStart - item.start_min);
        for (const g of list) {
          const ns = clamp(g.start + off, 0, 1440 - g.dur);
          store.actions.tasks.create(copyPayload(g.item, ns)).catch(showErr);
        }
      } else if (group) {
        store.batch("перенос", () => {
          for (const g of group) {
            const ns = clamp(g.start + delta, 0, 1440 - g.dur);
            if (ns !== g.start) store.actions.tasks.reschedule(g.item, { start_min: ns }).catch(showErr);
          }
        });
      } else if (item.kind === "concrete" && (() => { const z = dndZoneAt(ev.clientX, ev.clientY); return z === "tray" || z === "allday"; })()) {
        // В боковую панель или в зону «весь день» — снимаем время (день остаётся).
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
    const update = (ev) => {
      const zone = dndZoneAt(ev.clientX, ev.clientY);
      const gridMin = zone === "grid" && innerRef.current ? clamp(snap(yToMin(ev.clientY)), 0, 1440 - dur) : null;
      setDnd({ source: "tray", title: t.title, color: listById[t.list_id]?.color || "var(--accent)",
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
      clearTimeout(hold); cleanup();
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

  // Сохранить новый порядок задач «весь день»: переставленную задачу вставляем на
  // позицию overIndex, всем строкам присваиваем sort_order по новому порядку.
  function persistAllDayOrder(draggedKey, overIndex) {
    const keys = allDay.map(i => i.key);
    const order = keys.filter(k => k !== draggedKey);
    order.splice(clamp(overIndex, 0, order.length), 0, draggedKey);
    store.batch("порядок", () => {
      order.forEach((k, idx) => {
        const it = allDay.find(x => x.key === k);
        if (!it) return;
        const rid = rowIdOf(it);
        if ((sortOrderById.get(rid) ?? 0) !== idx) store.actions.tasks.update(rid, { sort_order: idx }).catch(showErr);
      });
    });
  }

  // Перетаскивание карточки «весь день»: внутри зоны — перестановка (3 столбца),
  // вниз в сетку — назначить время (как из боковой панели).
  function startAllDayDrag(e, item) {
    if (e.pointerType !== "touch" && e.button !== 0) return;
    const touch = e.pointerType === "touch";
    const srcEl = e.target.closest(".allday-item");
    const fromIndex = allDay.findIndex(x => x.key === item.key);
    if (fromIndex < 0 || !srcEl) return;
    const sx = e.clientX, sy = e.clientY;
    const dur = 60;
    let active = false, mode = null, hold = null, overIndex = fromIndex;
    let grab = { dx: 0, dy: 0 }, metrics = null;

    const measure = (ev) => {
      const r = srcEl.getBoundingClientRect();
      grab = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      const first = adGridRef.current.querySelector(".allday-item") || srcEl;
      const fr = first.getBoundingClientRect();
      const cs = getComputedStyle(adGridRef.current);
      metrics = { left: fr.left, top: fr.top, cw: r.width, ch: r.height,
        gx: parseFloat(cs.columnGap) || 0, gy: parseFloat(cs.rowGap) || 0, w: r.width, h: r.height };
    };
    const floatTo = (ev) => { const el = adChipRef.current; if (el) el.style.transform = `translate(${ev.clientX - grab.dx}px, ${ev.clientY - grab.dy}px) scale(1.04)`; };
    const idxAt = (ev) => {
      const col = clamp(Math.floor((ev.clientX - metrics.left) / (metrics.cw + metrics.gx)), 0, ALLDAY_COLS - 1);
      const row = Math.max(0, Math.floor((ev.clientY - metrics.top) / (metrics.ch + metrics.gy)));
      return clamp(row * ALLDAY_COLS + col, 0, allDay.length - 1);
    };
    const beginReorder = (ev) => {
      active = true; mode = "reorder"; trayClickGuard.current = true;
      measure(ev);
      overIndex = fromIndex;
      setDnd(null);
      setAdDrag({ key: item.key, fromIndex, overIndex, w: metrics.w, h: metrics.h,
        title: item.title, color: colorOf(item), done: item.done, icon: item.icon });
      requestAnimationFrame(() => floatTo(ev));
    };
    const move = (ev) => {
      if (!active) {
        if (touch) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { clearTimeout(hold); cleanup(); } return; }
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        beginReorder(ev);
      }
      ev.preventDefault();
      const zone = dndZoneAt(ev.clientX, ev.clientY);
      if (zone === "grid" && item.kind === "concrete" && innerRef.current) {
        if (mode !== "schedule") { mode = "schedule"; setAdDrag(null);
          const gr = innerRef.current.getBoundingClientRect(); dndGeomRef.current = { left: gr.left, width: gr.width, startX: ev.clientX }; }
        const gridMin = clamp(snap(yToMin(ev.clientY)), 0, 1440 - dur);
        setDnd({ source: "tray", title: item.title, color: colorOf(item), x: ev.clientX, y: ev.clientY, zone: "grid", gridMin, dur });
        return;
      }
      if (mode !== "reorder") {
        mode = "reorder"; setDnd(null);
        setAdDrag({ key: item.key, fromIndex, overIndex, w: metrics.w, h: metrics.h,
          title: item.title, color: colorOf(item), done: item.done, icon: item.icon });
      }
      floatTo(ev);
      const ni = idxAt(ev);
      if (ni !== overIndex) { overIndex = ni; haptic(); setAdDrag(d => d ? { ...d, overIndex: ni } : d); }
    };
    const up = (ev) => {
      clearTimeout(hold); cleanup();
      if (!active) return;
      const zone = dndZoneAt(ev.clientX, ev.clientY);
      const releaseGuard = () => setTimeout(() => { trayClickGuard.current = false; }, 0);
      if (mode === "schedule" && zone === "grid" && innerRef.current) {
        const start = clamp(snap(yToMin(ev.clientY)), 0, 1440 - dur);
        store.actions.tasks.update(item.id, { date, start_min: start, duration_min: dur }).catch(showErr);
        setAdDrag(null); setDnd(null); releaseGuard();
        return;
      }
      setDnd(null);
      const moved = mode === "reorder" && overIndex !== fromIndex;
      // Плавная посадка: карточка доезжает до своего места, затем фиксируем порядок.
      const ph = adGridRef.current && adGridRef.current.querySelector('[data-adkey="__adph"]');
      const el = adChipRef.current;
      if (el && ph) {
        const r = ph.getBoundingClientRect();
        el.style.transition = "transform .26s cubic-bezier(.2,.9,.25,1), box-shadow .26s ease";
        el.style.boxShadow = "0 2px 8px rgba(15,23,42,.10)";
        el.style.transform = `translate(${r.left}px, ${r.top}px) scale(1)`;
        setTimeout(() => { if (moved) persistAllDayOrder(item.key, overIndex); setAdDrag(null); }, 270);
      } else {
        if (moved) persistAllDayOrder(item.key, overIndex);
        setAdDrag(null);
      }
      releaseGuard();
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    if (touch) hold = setTimeout(() => beginReorder({ clientX: sx, clientY: sy }), HOLD_MS);
  }

  function onResizePointerDown(e, item) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    let newDur = item.duration_min;
    const move = ev => { newDur = clamp(snap(yToMin(ev.clientY) - item.start_min), MIN_DUR, 1440 - item.start_min);
      setDrag({ type: "resize", key: item.key, start: item.start_min, dur: newDur }); };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
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
    const move = ev => {
      newStart = clamp(snap(yToMin(ev.clientY)), 0, end - MIN_DUR);
      newDur = end - newStart;
      setDrag({ type: "resize", key: item.key, start: newStart, dur: newDur });
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
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
    setFilter(l.id); setProjOpen(false);
  }
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
  }
  // Свайпа не хватило — лента плавно возвращается в центр (день не меняется).
  function daySwipeSnapBack() {
    const track = trackRef.current;
    if (!track) return;
    swipingRef.current = false;
    track.style.transition = "transform .28s cubic-bezier(.22,.61,.36,1)";
    void track.offsetWidth;
    track.style.transform = "translateX(-100%)";
    const onBack = () => { track.removeEventListener("transitionend", onBack); track.style.transition = ""; track.style.transform = ""; schedulePeekOff(); };
    track.addEventListener("transitionend", onBack);
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
  // Живая позиция перетаскиваемой задачи (десктоп — drag, мобильный подъём — liftDrag).
  let liveDrag = null;
  if (drag && (drag.type === "move" || drag.type === "copy" || drag.type === "resize")) {
    liveDrag = { key: drag.key, start: drag.start, dur: drag.dur };
  } else if (liftDrag && !liftDrag.landing && !liftDrag.done && !liftDrag.allday && liftItemRef.current) {
    const it = liftItemRef.current, dur = it.duration_min || 0;
    const start = clamp(snap(it.start_min + Math.round((liftDrag.dy / hourPx) * 60)), 0, 1440 - dur);
    liveDrag = { key: liftDrag.key, start, dur };
  }
  // Сколько чужих задач сейчас перекрывает призрак по времени — на столько «полос»
  // он уводится вбок (обтекает их капсулы). 0 — призрак во всю ширину, как обычно.
  const ghostOverlap = useMemo(() => {
    if (!liveDrag) return 0;
    const s = liveDrag.start, e = liveDrag.start + liveDrag.dur;
    let n = 0;
    for (const it of dayTl) {
      if (it.key === liveDrag.key) continue;
      if (it.vTop < e && it.vEnd > s) n++;
    }
    return Math.min(n, 3); // не уводим слишком далеко
  }, [dayTl, liveDrag && liveDrag.key, liveDrag && liveDrag.start, liveDrag && liveDrag.dur]);

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
  // В боковой панели — для задач без даты/времени (если они в текущей панели).
  const edPanel = (editing && edTask && !edTask.date && trayTasks.some(t => t.id === edTask.id))
    || (creating && !creating.date);
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
        return html`<div class=${"tl-event" + density + (i.done ? " done" : "") + (i.spanTop ? " span-top" : "") + (i.spanBottom ? " span-bottom" : "")} key=${i.key}
          style=${`top:${top}px;height:${height}px;--c:${colorOf(i)};`}>
          <div class="tl-pill"><span class=${"tl-pill-check" + (i.done ? " on" : "")} style=${`--drop:${Math.max(0, height - 34)}px;`}>${Icon.check()}</span></div>
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
      .filter(i => (i.start_min === null || i.start_min === undefined) && matches(i));
    const rowIdOfX = (i) => i.kind === "occurrence" ? i.templateId : i.id;
    all.sort((a, b) => ((sortOrderById.get(rowIdOfX(a)) ?? 0) - (sortOrderById.get(rowIdOfX(b)) ?? 0))
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return html`<div class="tl-peek">
      <div class=${"allday" + (all.length === 0 ? " empty" : "") + (all.length ? " grid" : "")} style=${`--adh:${AD_COLLAPSED}px`}>
        ${all.map(i => html`<div class=${"allday-item" + (i.done ? " done" : "")} key=${i.key}>
          <span class=${"allday-check" + (i.done ? " on" : "")} style=${`border-color:${colorOf(i)};color:${colorOf(i)};`}>${Icon.check()}</span>
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
      const items = itemsForDate(tasks, iso).filter(i => matches(i));
      const t = items.filter(i => i.start_min !== null && i.start_min !== undefined);
      return { iso, day: dd.getDate(), short: WD_SHORT[k], isToday: iso === todayISO(),
        timed: layoutColumns(t, null), untimed: items.filter(i => i.start_min === null || i.start_min === undefined) };
    });
  }
  function buildMonth(baseISO) {
    const weeks = monthMatrix(baseISO);
    const items = {};
    for (const wk of weeks) for (const c of wk)
      items[c.iso] = itemsForDate(tasks, c.iso).filter(i => matches(i))
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
        ${wdays.map((wd, di) => html`<div class="week-col" key=${wd.iso}
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
  // Проекты без области (или область удалена) показываем отдельной группой снизу.
  const looseProjects = lists.filter(l => !l.area_id || !areaById[l.area_id]);

  // Строка проекта в меню — общая для проектов внутри области и «без области».
  const projRowEl = (l) => html`
    <div class=${"proj-row" + (swipeId === l.id ? " swipe-open" : "")} key=${l.id}>
      <div class="proj-row-actions">
        <button class="edit" title="Изменить" onClick=${() => { setListModal(l); setSwipeId(null); setProjOpen(false); }}>${Icon.edit()}</button>
        <button class="del" title="Удалить" onClick=${() => { setDelList(l); setSwipeId(null); setProjOpen(false); }}>${Icon.trash()}</button>
      </div>
      <button class=${"proj-opt" + (filter === l.id ? " active" : "")}
        onPointerDown=${e => projSwipe(e, l)} onClick=${() => selectProj(l)}
        onContextMenu=${e => { e.preventDefault(); setSwipeId(null); setCtx({ list: l, x: e.clientX, y: e.clientY }); }}>
        <span class="proj-opt-ico" style=${`color:${l.color || "var(--accent)"};`}>${Icon.dot()}</span>
        <span class="proj-opt-name">${l.name}</span>
        <span class="proj-opt-count">${countOpen(tasks, l.id)}</span></button>
    </div>`;

  return html`
    <div class="app">
      <div class=${"planner" + (asideOpen ? " aside-open" : "")}>
        <aside class="planner-aside" ref=${asideRef} onTouchStart=${onAsideSwipeStart}>
          <div class=${"proj-select" + (projOpen ? " open" : "")} ref=${projRef}>
            <button class="proj-current" onClick=${() => setProjOpen(o => !o)}>
              <span class="proj-current-ico" style=${`color:${filterColor};`}>${filterIcon}</span>
              <span class="proj-current-name">${filterName}</span>
              <span class="proj-caret">${Icon.right()}</span>
            </button>
            <div class="proj-menu">
              <button class=${"proj-opt" + (filter === "all" ? " active" : "")} onClick=${() => { setFilter("all"); setProjOpen(false); }}>
                <span class="proj-opt-ico" style="color:var(--accent);">${Icon.calendar()}</span>
                <span class="proj-opt-name">Все задачи</span></button>
              <button class=${"proj-opt" + (filter === "inbox" ? " active" : "")} onClick=${() => { setFilter("inbox"); setProjOpen(false); }}>
                <span class="proj-opt-ico" style="color:#64748b;">${Icon.inbox()}</span>
                <span class="proj-opt-name">Входящие</span>
                <span class="proj-opt-count">${countOpen(tasks, null)}</span></button>
              <button class=${"proj-opt" + (filter === "done" ? " active" : "")} onClick=${() => { setFilter("done"); setProjOpen(false); }}>
                <span class="proj-opt-ico" style="color:#16a34a;">${Icon.check()}</span>
                <span class="proj-opt-name">Завершено</span></button>
              <button class=${"proj-opt" + (filter === "trash" ? " active" : "")} onClick=${() => { setFilter("trash"); setProjOpen(false); }}>
                <span class="proj-opt-ico" style="color:#94a3b8;">${Icon.trash()}</span>
                <span class="proj-opt-name">Корзина</span>
                <span class="proj-opt-count">${trashTasks.length || ""}</span></button>

              ${areasSorted.map(a => html`
                <div class="area-group" key=${a.id}>
                  <div class="area-head">
                    <button class="area-toggle" title=${areaCollapsed.has(a.id) ? "Развернуть" : "Свернуть"}
                      onClick=${() => toggleArea(a.id)}>
                      <span class=${"area-chev" + (areaCollapsed.has(a.id) ? "" : " open")}>${Icon.right()}</span></button>
                    <button class=${"proj-opt area-opt" + (filter === "area:" + a.id ? " active" : "")}
                      onClick=${() => { setFilter("area:" + a.id); setProjOpen(false); }}
                      onContextMenu=${e => { e.preventDefault(); setCtx({ area: a, x: e.clientX, y: e.clientY }); }}>
                      <span class="proj-opt-ico" style="color:var(--accent);">${Icon.folder()}</span>
                      <span class="proj-opt-name">${a.name}</span>
                      <span class="proj-opt-count">${countArea(tasks, a.id, areaOfList)}</span></button>
                    <div class="area-actions">
                      <button class="edit" title="Изменить" onClick=${() => { setAreaModal(a); setProjOpen(false); }}>${Icon.edit()}</button>
                      <button class="del" title="Удалить" onClick=${() => { setDelArea(a); setProjOpen(false); }}>${Icon.trash()}</button>
                    </div>
                  </div>
                  ${!areaCollapsed.has(a.id) && html`<div class="area-projects">
                    ${lists.filter(l => l.area_id === a.id).map(projRowEl)}
                    <button class="proj-opt proj-opt-new sm" onClick=${() => { setListModal({ area_id: a.id }); setProjOpen(false); }}>
                      <span class="proj-opt-ico">${Icon.plus()}</span>
                      <span class="proj-opt-name">Проект в области</span></button>
                  </div>`}
                </div>`)}

              ${looseProjects.length > 0 && areasSorted.length > 0 && html`<div class="proj-sep">Проекты</div>`}
              ${looseProjects.map(projRowEl)}

              <button class="proj-opt proj-opt-new" onClick=${() => { setListModal("new"); setProjOpen(false); }}>
                <span class="proj-opt-ico">${Icon.plus()}</span>
                <span class="proj-opt-name">Новый проект</span></button>
              <button class="proj-opt proj-opt-new" onClick=${() => { setAreaModal("new"); setProjOpen(false); }}>
                <span class="proj-opt-ico">${Icon.folder()}</span>
                <span class="proj-opt-name">Новая область</span></button>
            </div>
          </div>

          ${!special && html`<div class="proj-tasks">
            ${trayTasks.length === 0
              ? html`<div class="muted small" style="padding:10px 6px;">Здесь пока нет задач.</div>`
              : trayTasks.map(t => (editing && edTask && !edTask.date && edTask.id === t.id)
                ? html`<div key=${t.id}>${editorEl}</div>`
                : html`
                <div class="tray-task-wrap" key=${t.id} onPointerDown=${e => startTrayDrag(e, t)}>
                  <div class=${"tray-task" + (t.done ? " done" : "")}>
                  <button class=${"task-check" + (t.done ? " on" : "")} title="Выполнено"
                    style=${t.done ? `background:${listById[t.list_id]?.color || "var(--accent)"};border-color:${listById[t.list_id]?.color || "var(--accent)"};` : ""}
                    onPointerDown=${e => e.stopPropagation()}
                    onClick=${() => { if (!t.done) popConfetti("tray:" + t.id); toggleDone({ kind: "concrete", id: t.id, done: t.done }); }}>${Icon.check()}${confettiEl("tray:" + t.id, "center")}</button>
                  <button class="tray-task-body" onClick=${() => { if (trayClickGuard.current) return; setEditing({ task: t, occ: null }); }}>
                    <span class="tray-task-title">${t.title}</span>
                    <span class="tray-task-meta">
                      ${filter === "all" && t.list_id ? html`<span class="tray-task-list" style=${`color:${listById[t.list_id]?.color};`}>${listById[t.list_id]?.name} · </span>` : ""}${taskMeta(t)}</span>
                  </button>
                  ${!t.date ? html`<button class="btn-mini" title="Запланировать на этот день" onPointerDown=${e => e.stopPropagation()} onClick=${() => quickSchedule(t)}>${Icon.clock()}</button>` : ""}
                  </div>
                </div>`)}
            ${creating && !creating.date && editorEl}
            ${!(creating && !creating.date) && html`<button class="btn sm ghost proj-add"
              onClick=${() => setCreating(newTaskTarget())}>
              ${Icon.plus()} Добавить задачу</button>`}
          </div>`}
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
              <div class=${"allday" + (allDay.length === 0 ? " empty" : "") + (allDay.length ? " grid" : "") + ((dnd && dnd.zone === "allday") || (liftDrag && liftDrag.allday) ? " drop" : "")} ref=${adGridRef} style=${`--adh:${adH}px`}>
                ${(() => {
                  const cell = (i) => html`
                    <div class=${"allday-item" + (i.done ? " done" : "")} key=${i.key} data-adkey=${i.key}
                      onPointerDown=${e => { if (i.id) startAllDayDrag(e, i); }}>
                      <button class=${"allday-check" + (i.done ? " on" : "")} type="button" title="Выполнено"
                        style=${`border-color:${colorOf(i)};color:${colorOf(i)};`}
                        onClick=${() => { if (trayClickGuard.current) return; if (!i.done) popConfetti("ad:" + i.key); toggleDone(i); }}>${Icon.check()}${confettiEl("ad:" + i.key, "center")}</button>
                      ${titleEdit && titleEdit.key === i.key
                        ? html`<input class="allday-edit" value=${titleEdit.value}
                            ref=${el => { if (el && !el._fe) { el._fe = true; el.focus(); const n = el.value.length; const c = titleEdit.caret; const pos = (c == null || c > n) ? n : c; try { el.setSelectionRange(pos, pos); } catch (e) {} } }}
                            onInput=${e => setTitleEdit({ key: i.key, value: e.target.value, caret: titleEdit.caret })}
                            onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); commitTitle(i); } else if (e.key === "Escape") { e.preventDefault(); setTitleEdit(null); } }}
                            onBlur=${() => commitTitle(i)} />`
                        : html`<span class="allday-title" onClick=${e => { e.stopPropagation(); if (trayClickGuard.current) return; startTitleEdit(i, caretOffsetFromClick(e)); }}>${i.title}</span>`}
                    </div>`;
                  if (!adDrag) return allDay.map(cell);
                  const rest = allDay.filter(i => i.key !== adDrag.key);
                  const slots = rest.slice(0, adDrag.overIndex).map(cell);
                  slots.push(html`<div class="allday-item ad-placeholder" key="__adph" data-adkey="__adph" style=${`height:${adDrag.h}px;`}></div>`);
                  rest.slice(adDrag.overIndex).forEach(i => slots.push(cell(i)));
                  const dragged = allDay.find(i => i.key === adDrag.key);
                  slots.push(html`<div class="allday-float" key="__adfloat" ref=${adChipRef} style=${`width:${adDrag.w}px;`}>
                    <button class=${"allday-check" + (adDrag.done ? " on" : "")} type="button"
                      style=${`border-color:${adDrag.color};color:${adDrag.color};`}>${Icon.check()}</button>
                    <span class="allday-title">${dragged ? dragged.title : adDrag.title}</span>
                  </div>`);
                  return slots;
                })()}
              </div>
              <div class="allday-handle" onPointerDown=${onAllDayHandleDown} onTouchStart=${e => e.stopPropagation()}><span class="allday-grip"></span></div>
              <div class=${"tl" + (drag ? " busy" : "")} ref=${innerRef} onPointerDown=${onGridPointerDown} style=${`height:${24 * hourPx}px;`}>
                ${Array.from({ length: 25 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
                  <span class=${"grid-hour-label" + (h === 24 ? " last" : "")}>${(h % 24 === 0 ? "00" : String(h).padStart(2, "0"))}:00</span></div>`)}
                <div class="tl-spine"></div>
                ${isToday && html`<div class="grid-now" style=${`top:${(nowMin / 60) * hourPx}px;`}>
                  <span class="grid-now-time">${minToHHMM(nowMin)}</span><span class="grid-now-dot"></span></div>`}
                ${selRange && html`<div class="tl-selrect"
                  style=${`top:${(selRange.lo / 60) * hourPx}px;height:${((selRange.hi - selRange.lo) / 60) * hourPx}px;`}></div>`}
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
                  const density = height >= 44 ? "" : height >= 24 ? " compact" : " mini";
                  // Колонки при пересечении: задача занимает свою долю ширины и сдвигается
                  // вправо. При переносе/растягивании одной задачи её слот живой (обтекает
                  // соседей). Групповой перенос и переходящая через полночь — на всю ширину.
                  const slot = dayCols.get(i.key);
                  // Перетаскиваемый призрак рисуем во всю ширину (cols=1) — вбок уводим
                  // только его капсулу (.flowing). Групповой/спан — тоже во всю ширину.
                  const isLiveDragKey = liveDrag && liveDrag.key === i.key;
                  const cols = (spanning || inGroupMove || isLiveDragKey || !slot) ? 1 : slot.cols;
                  const colStyle = cols > 1 ? `--cols:${cols};--col:${slot.col};` : "";
                  const down = spanning ? (e => e.stopPropagation()) : (e => onBlockPointerDown(e, i));
                  const tap = spanning ? (e => { e.stopPropagation(); openPreview(i); }) : null;
                  // Поднятую задачу рисуем плавающей копией поверх (см. ниже). Сам элемент в
                  // ленте НЕ удаляем (иначе iOS шлёт pointercancel → перенос срывается) — прячем
                  // через visibility:hidden, место и касание сохраняются.
                  const hiddenLift = liftDrag && !liftDrag.done && i.key === liftDrag.key;
                  return html`<div class=${"tl-event" + density + (cols > 1 ? " columned" : "") + (i.done ? " done" : "") + (dragging ? " dragging" : "") + (sel ? " sel" : "") + (hiddenLift ? " lift-hidden" : "") + (i.spanTop ? " span-top" : "") + (i.spanBottom ? " span-bottom" : "") + (openSubs.has(i.key) ? " subs-open" : "")} key=${i.key}
                    style=${`top:${top}px;height:${height}px;--c:${colorOf(i)};${colStyle}`}
                    onPointerDown=${down}
                    onContextMenu=${e => { e.preventDefault(); e.stopPropagation(); openPreview(i); }}>
                    <div class="tl-pill" onPointerDown=${down} onClick=${tap}>
                      <button class=${"tl-pill-check" + (i.done ? " on" : "") + (fallKey === i.key ? " falling" : "")} type="button" title="Выполнено"
                        style=${`--drop:${Math.max(0, height - 34)}px;`}
                        onPointerDown=${e => e.stopPropagation()}
                        onClick=${e => { e.stopPropagation(); completeToggle(i); }}>${Icon.check()}</button>
                      ${confettiEl(i.key)}
                      ${sel && !spanning && html`<div class="tl-dot top" onPointerDown=${e => onResizeTopPointerDown(e, i)}></div>`}
                      ${sel && !spanning && html`<div class="tl-dot bottom" onPointerDown=${e => onResizePointerDown(e, i)}></div>`}
                    </div>
                    ${!spanning && html`<div class="tl-handle top" onPointerDown=${e => onResizeTopPointerDown(e, i)}></div>`}
                    ${!spanning && html`<div class="tl-handle bottom" onPointerDown=${e => onResizePointerDown(e, i)}></div>`}
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
                ${liftDrag && !liftDrag.done && !liftDrag.allday && liftItemRef.current && (() => {
                  // Призрак на месте приземления: задача едет за пальцем (плавающая копия),
                  // а здесь, на разметке часов, прозрачный призрак показывает новое время.
                  // По отпускании задача «доезжает» сюда и встаёт на это время. Над зоной
                  // «весь день» призрак прячем — задача уйдёт туда.
                  const it = liftItemRef.current, dur = it.duration_min || 0;
                  const lm = clamp(snap(it.start_min + Math.round((liftDrag.dy / hourPx) * 60)), 0, 1440 - dur);
                  return html`<div class=${"tl-ghost lift-target" + (ghostOverlap > 0 ? " flowing" : "")} style=${`top:${(lm / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, (dur / 60) * hourPx)}px;--c:${colorOf(it)};--lane:${ghostOverlap};`}>
                    <div class="tl-ghost-pill"></div>
                    <div class="tl-ghost-label">${minRangeLabel(lm, dur)}</div></div>`;
                })()}
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
                ${dnd && dnd.source === "tray" && dnd.zone === "grid" && dnd.gridMin !== null && html`<div class="tl-ghost lift-target"
                  style=${`top:${(dnd.gridMin / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, (dnd.dur / 60) * hourPx)}px;--c:${dnd.color};`}>
                  <div class="tl-ghost-pill"></div>
                  <div class="tl-ghost-label">${minRangeLabel(dnd.gridMin, dnd.dur)}</div></div>`}
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
      ${dnd.zone === "tray" ? html`<span class="dnd-ghost-hint">снять время</span>` : ""}
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
    ${liftDrag && !liftDrag.done && liftItemRef.current && liftGeomRef.current && (() => {
      // Плавающая копия поднятой задачи (fixed, поверх всего) — едет за пальцем и не
      // уезжает с лентой, пока второй палец листает дни. Доезжает на место и сменяется
      // настоящей задачей в сетке (кадр .done).
      const it = liftItemRef.current, g = liftGeomRef.current, landing = liftDrag.landing;
      const dur = it.duration_min || 0;
      const liftMin = clamp(snap(it.start_min + Math.round((liftDrag.dy / hourPx) * 60)), 0, 1440 - dur);
      const density = g.height >= 44 ? "" : g.height >= 24 ? " compact" : " mini";
      return html`<div class=${"tl-event tl-lift-overlay" + density + (it.done ? " done" : "") + (landing ? " landing" : " lifted")}
        style=${`top:${g.top}px;left:${g.left}px;width:${g.width}px;height:${g.height}px;--c:${colorOf(it)};transform:translate(${liftDrag.dx}px,${liftDrag.dy}px)${landing ? "" : " scale(1.04)"};`}>
        <div class="tl-pill"><button class=${"tl-pill-check" + (it.done ? " on" : "")} type="button">${Icon.check()}</button></div>
        <div class="tl-body"><div class="tl-text">
          <div class="tl-titlerow"><div class="tl-title">${it.title}${it.recurring ? html` <span class="tl-rep">${Icon.repeat()}</span>` : ""}</div></div>
          <div class="tl-meta">${minRangeLabel(liftMin, dur)} (${durHuman(dur)})</div>
        </div></div>
      </div>`;
    })()}
    <input ref=${kbPrimerRef} class="kb-primer" type="text" inputmode="text" />
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

function countOpen(tasks, listId) {
  const n = tasks.filter(t => !t.recurrence_parent && !t.done && !t.deleted_at
    && (listId ? t.list_id === listId : (!t.list_id && !t.area_id))).length;
  return n || "";
}
// Незавершённые задачи области: и прямо на области, и во всех её проектах.
function countArea(tasks, areaId, areaOfList) {
  const n = tasks.filter(t => !t.recurrence_parent && !t.done && !t.deleted_at
    && (t.area_id === areaId || (t.list_id && areaOfList(t.list_id) === areaId))).length;
  return n || "";
}
