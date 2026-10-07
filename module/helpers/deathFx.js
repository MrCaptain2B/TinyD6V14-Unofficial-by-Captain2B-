/* ============================================================
   Homerule: TinyD6+ / эффект умирания на токене.

   Схема крепления - ровно как у Token Magic FX: эффект - это
   PIXI.Filter (шейдер), поставленный ВНУТРЬ `token.mesh.filters`,
   а не отдельный контейнер/спрайт на канвасе. Фильтр исполняется
   PIXI как часть отрисовки самого токена, поэтому он виден ВСЕГДА.

   Механика координат - копия TM CustomFilter (fx/filters/CustomFilter.js):
   каждый кадр вычисляется uniform `filterMatrix` (destFrame -> sourceFrame
   -> inv(worldTransform) -> -localBounds -> scale(1/w,1/h)) и
   `filterMatrixInverse`; вершинник customvertex2D даёт vFilterCoord
   (норм. координаты В ТОКЕНЕ 0..1). Никаких текстур наложения, якорных
   спрайтов и UV-матриц - поэтому "токен на токене" невозможен в принципе,
   выравнивание гарантировано самой матрицей.

   Ступени (совпадают со ступенями в tinyd6.js и death.js):
     3 (5+ р.): красная кромка от середины к краям токена
     2 (3-4 р.): К кромке ДОБАВЛЯЕТСЯ кровавый сплэш из точки
                 (брызги-лучи, капли, туман - как макрос TM 34)
     1 (<3 р.):  К кромке и сплэшу добавляется заливка СЕРЕДИНОЙ
                 + пульс-«сердцебиение» (зум содержимого)
   Стадии КУМУЛЯТИВНЫ: переход на следующую ничего не убирает, новый
   слой плавно (lerp весов в _frame) нарастает поверх предыдущих -
   эффект цельный, без скачков. При смерти фильтры НЕ снимаются
   (сверху накладывается тёмный тинт «умер»), пульс замирает; эффект
   убирается только при лечении/стабилизации (см. death.js).

   Маска везде гейтится альфой самого токена (tok.a), поэтому краснота
   никогда не выходит за силуэт токена («красный квадрат за токеном»
   исключён).

   Документ-тинт «умер» (тёмный, texture.tint в tinyd6.js) остаётся
   отдельным финальным слоем; красный tint-дублёр убран.

   Отрисовка видна всем: GM рассылает состояние по socket (setDeathFx),
   каждый клиент вешает свой фильтр на свою сцену.
   Глобальные выключатели: enableDeathFx и общий animFx.
   ============================================================ */

/* Потолок одновременных эффектов - чтобы толпа умирающих не клала
 * слабые машины. Достигнут предел: вытесняется самый старый эффект. */
const MAX_ACTIVE_EFFECTS = 12;

/* Активные оверлеи: actorId -> { tokenId, stage, phase, ok, fx, tokenMesh,
 * seed, removing, delT } */
const OVERLAYS = new Map();

/* Таймер анимации активен (регистрируется один раз). */
let TICKER_ON = false;

/* Время предыдущего кадра (fallback для dt, если ticker.deltaMS = 0). */
let _frameLast = 0;

/* Интервал троттлинга пульса:.primary перепекается ~12 раз/сек
 * вместо каждого кадра. Шейдер обновляется плавно (uniform на каждом
 * кадре), но renderDirty = true только каждые 80 мс. */
let _pulseAccum = 0;
const PULSE_DT = 80;

/* Включены ли вообще анимации (настройка мира animFx). */
function _animFxEnabled() {
    try { return game.settings.get("tinyd6v14", "animFx") !== false; }
    catch (err) { return true; }
}

/* Включён ли эффект умирания (настройка мира enableDeathFx). */
function _deathFxEnabled() {
    try { return game.settings.get("tinyd6v14", "enableDeathFx") !== false; }
    catch (err) { return true; }
}

/* Ступень эффекта по остатку раундов (совпадает с _dyingTierOf в tinyd6.js):
 * 5+ -> 3 (лёгкая), 3-4 -> 2 (средняя), 1-2 -> 1 (тяжёлая). */
function _tierOf(left) {
    const n = Math.max(0, Math.ceil(Number(left) || 0));
    if (n >= 5) return 3;
    if (n >= 3) return 2;
    return 1;
}

/* Токен на канвасе для актёра: по совпадению экземпляра актёра, иначе
 * единственная копия с таким actor.id (как у unlinked NPC). */
function _resolveToken(actorId) {
    if (!game.canvas?.scene || !canvas.tokens) return null;
    const list = canvas.tokens.placeables;
    if (canvas.tokens.placeables.some(t => t.actor?.id === actorId))
    {
        return list.find(t => t.actor?.id === actorId) ?? null;
    }
    const byId = list.filter(t => t.actor?.id === actorId);
    return byId.length === 1 ? byId[0] : null;
}

/* Целевые веса компонентов по ступени. Веса НАКАПЛИВАЮТСЯ: следующая
 * ступень не убирает предыдущие, а добавляет поверх (кромка постоянна,
 * сплэш копится со 2-й, центр-заливка с 1-й). */
const C_TARGETS = {
    3: { rim: 1, splash: 0, center: 0 },
    2: { rim: 1, splash: 0.85, center: 0 },
    1: { rim: 1, splash: 1, center: 1 }
};

/* Скорость плавного прироста/убывания весов за кадр. */
const COMP_SMOOTH = 0.05;

/* --- Диагностика (F12) --- */

let _fxDiagLog = [];
const MAX_DIAG = 40;

/* Счётчики для диагностики всей цепочки. */
const _fxStats = { applied: 0, removed: 0, skippedNoFx: 0, tokenMissing: 0, built: 0, cappedOut: 0, frameErrors: 0 };

function _fxDiag(reason) {
    _fxDiagLog.push(`[${new Date().toTimeString().slice(0,8)}] ${reason}`);
    if (_fxDiagLog.length > MAX_DIAG) _fxDiagLog.shift();
    console.debug("tinyd6 | deathFx:", _fxDiagLog[_fxDiagLog.length - 1]);
    return null;
}

/* Сколько красных (именно НАШИХ) пикселей в RGBA-буфере. */
function _redInPixels(d) {
    if (!d) return -1;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
    {
        if (d[i] > 110 && d[i + 1] < 90 && d[i + 2] < 90) n++;
    }
    return n;
}

let TRUTH_ON = false;

/* Включает/выключает автодиагностику: через 600 мс после каждой сборки
 * печатает правду о рендере (фильтр на месте, сколько красных пикселей
 * рисует GPU прямо из токена). */
globalThis.tinyd6DeathFxTruth = () => {
    TRUTH_ON = !TRUTH_ON;
    CONFIG.logger.info("tinyd6 | TRUTH автодиагностика:", TRUTH_ON ? "ВКЛ" : "ВЫКЛ");
    return TRUTH_ON;
};

function _truthReport(entry, mesh) {
    try {
        const f = entry.fx;
        if (!f || f.destroyed) { console.info("tinyd6 | TRUTH: fx уничтожен", entry.actorId); return; }
        let red = null;
        try
        {
            if (canvas?.app?.renderer?.extract?.pixels && mesh && !mesh.destroyed) red = _redInPixels(canvas.app.renderer.extract.pixels(mesh));
            else red = "extract недоступен";
        }
        catch (err) { red = "extract err: " + err.message; }
        console.info("tinyd6 | TRUTH " + JSON.stringify({
            stage: entry.stage,
            alpha: +f.alpha.toFixed(3),
            pulse: +f.pulse.toFixed(3),
            tokenMeshAlive: !!(mesh && !mesh.destroyed),
            token: mesh && !mesh.destroyed
                ? { id: entry.tokenId, w: +mesh.width.toFixed(1), h: +mesh.height.toFixed(1), worldVisible: mesh.worldVisible }
                : "destroyed",
            filters: Array.isArray(mesh?.filters) ? mesh.filters.map(x => (x === f ? "DEATHFX" : (x.constructor?.name || "filter"))) : null,
            redPixels: red
        }));
    } catch (err) {
        console.warn("tinyd6 | TRUTH failed:", err);
    }
}

/* Отладочный хендл в консоли F12: состояние оверлеев + последние сбои. */
globalThis.tinyd6DeathFxDebug = () => {
    const entries = [...OVERLAYS.entries()].map(([actorId, e]) => ({
        actorId,
        tokenId: e.tokenId,
        stage: e.stage,
        ok: e.ok,
        removing: e.removing,
        phase: +e.phase.toFixed(0),
        alpha: e.fx && !e.fx.destroyed ? +e.fx.alpha.toFixed(2) : null,
        pulse: e.fx && !e.fx.destroyed ? +e.fx.pulse.toFixed(3) : null,
        filtersOnMesh: e.tokenMesh && !e.tokenMesh.destroyed && Array.isArray(e.tokenMesh.filters) ? e.tokenMesh.filters.length : 0,
        texKey: e.texKey
    }));
    CONFIG.logger.info("tinyd6 | deathFx overlays:", entries);
    CONFIG.logger.info("tinyd6 | deathFx failures:", _fxDiagLog);
    CONFIG.logger.info("tinyd6 | deathFx stats:", _fxStats);
    return { overlays: OVERLAYS.size, stats: { ..._fxStats }, failures: [..._fxDiagLog] };
};

/* Одно-командный тест рендера: вешает фильтр на первый токен сцены
 * (ступени 3 → 2 → 1, затем убирает). Фильтр работает и без реальной
 * смерти персонажа - видимость проверяется просто. */
globalThis.tinyd6DeathFxTest = () => {
    if (!game.canvas?.scene || !canvas?.tokens?.placeables?.length)
    {
        CONFIG.logger.warn("tinyd6 | deathFx test: нет размещённых токенов на текущей сцене");
        return false;
    }
    const token = canvas.tokens.placeables[0];
    const actorId = token.actor?.id || token.document.actorId;
    if (!actorId)
    {
        CONFIG.logger.warn("tinyd6 | deathFx test: у первого токена нет актёра");
        return false;
    }
    const sceneId = game.canvas.scene.id;
    applyDeathFx({ actorId, sceneId, tier: 3 });
    CONFIG.logger.info("tinyd6 | deathFx test стартовал на токене", token.id, "-> ступени 3, 2, 1");
    let i = 0;
    const iv = setInterval(() => {
        i++;
        if (i < 3) applyDeathFx({ actorId, sceneId, tier: 3 - i });
        else
        {
            clearInterval(iv);
            setTimeout(() => removeDeathFx(actorId), 2500);
            CONFIG.logger.info("tinyd6 | deathFx test завершён (эффект убран)");
        }
    }, 2500);
    return true;
};

/* --- GLSL --- */

/* Вершинник - точная копия TM customvertex2D: вызывает фильтровый
 * filterMatrix и отдаёт vFilterCoord (норм. координаты в токене 0..1). */
const VERT2D = `
precision mediump float;

attribute vec2 aVertexPosition;

uniform mat3 projectionMatrix;
uniform mat3 filterMatrix;
uniform vec4 inputSize;
uniform vec4 outputFrame;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

vec4 filterVertexPosition( void )
{
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
    return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0., 1.);
}

vec2 filterTextureCoord( void )
{
    return aVertexPosition * (outputFrame.zw * inputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vFilterCoord = (filterMatrix * vec3(vTextureCoord, 1.0)).xy;
}
`;

/* Фрагментник: ступени + кровь-всплески + пульс. Ничего не запекает и
 * не перерисовывает исходный арт - только подмешивает красный к токену
 * (и зум-пульс на ступени 3). */
const FRAG = `
precision mediump float;

uniform sampler2D uSampler;
uniform vec4 inputClamp;
uniform mat3 filterMatrixInverse;

uniform float uFade;
uniform float uScale;
uniform float uPulseAmp;
uniform float uRim;
uniform float uSplash;
uniform float uCenter;
uniform vec3  uRimColor;
uniform vec3  uBlood;
uniform float uSeed;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

/* Кровавые брызги. 3 КРУПНЫХ сплэша на КРАЯХ токена (кольцо вокруг центра,
 * не середина). ВСЁ геометрическое вычисляется дёшево через хэши от uSeed:
 * ноль sin/cos/exp/atan на фрагмент - шейдер лёгкий даже на слабых iGPU. */
float splashMask(vec2 g)
{
    float total = 0.0;
    for (int s = 0; s < 3; s++)
    {
        float sf = float(s);

        /* Точка-источник на кольце у края (хэш-направление + rsqrt). */
        vec2 du = vec2(fract(uSeed * 37.71 + sf * 3.17), fract(uSeed * 24.61 + sf * 7.91)) - 0.5;
        du = du / (length(du) + 1e-5);
        float rad = 0.34 + 0.09 * fract(uSeed * 11.0 + sf * 0.3819660);
        vec2 g0 = vec2(0.5) + du * rad;
        float sSeed = fract(uSeed * 13.7 + sf * 1.6180339);

        vec2 d = g - g0;
        float dist = length(d) + 1e-5;

        /* Крупное пятно с неровным краем (jitter радиуса, без sin). */
        float stainR = 0.13 + 0.05 * fract(sSeed * 7.131);
        float stain = 1.0 - smoothstep(stainR * 0.55, stainR, dist);

        /* Короткие лучи: 5 хэш-направлений, без тригонометрии. */
        float streaks = 0.0;
        for (int i = 0; i < 5; i++)
        {
            float fi = float(i);
            vec2 q = vec2(fract(sSeed * 12.98 + fi * 0.6180340) - 0.5,
                          fract(sSeed * 33.01 + fi * 1.6180340) - 0.5);
            q = q / (length(q) + 1e-5);
            float vx = d.x * q.x + d.y * q.y;
            float vy = -d.x * q.y + d.y * q.x;
            float reach = 0.14 + 0.14 * fract(sSeed * 6.3 + fi * 0.771);
            float wdt = 0.022 + 0.014 * fract(sSeed * 3.1 + fi * 0.3819660);
            /* Дешёвый аналог гаусса на smoothstep (вместо exp). */
            float fall = smoothstep(0.0, 0.6, (vy * vy) / (wdt * wdt));
            float streak = 1.0 - fall;
            streak *= smoothstep(0.0, reach * 0.2, vx);
            streak *= 1.0 - smoothstep(reach * 0.3, reach, vx);
            streaks += streak;
        }

        /* Затёки, стекающие вниз. */
        float drips = 0.0;
        for (int i = 0; i < 3; i++)
        {
            float fi = float(i);
            float x0 = g0.x + (fract(sSeed * 7.7 + fi * 0.31) - 0.5) * 0.3;
            float len = 0.12 + 0.08 * fract(sSeed * 4.21 + fi * 0.511);
            float below = step(g0.y + 0.01, g.y);
            float drip = 1.0 - smoothstep(0.0, 0.028, abs(g.x - x0));
            drip *= 1.0 - smoothstep(0.03, len, g.y - g0.y);
            drip *= below;
            drips += drip;
        }

        total += stain * 0.9 + streaks * 0.8 + drips * 0.7;
    }

    /* Мелкие капли-крапинки по силуэту (хэш-позиции). */
    float drops = 0.0;
    for (int i = 0; i < 13; i++)
    {
        float fi = float(i);
        vec2 hp = vec2(fract(uSeed * 9.73 + fi * 0.7548776),
                       fract(uSeed * 5.13 + fi * 1.2142142));
        vec2 p = vec2(0.5) + (hp - 0.5) * 1.2;
        float sz = 0.006 + 0.012 * fract(uSeed * 6.31 + fi * 0.3819660);
        float dd = length(g - p);
        drops += 1.0 - smoothstep(sz * 0.4, sz * 1.7, dd);
    }

    return clamp(total + drops * 0.8, 0.0, 1.0);
}

void main()
{
    /* Зум содержимого вокруг центра (тяжёлая ступень - пульс). uScale==1 - покой. */
    vec2 uvp = vFilterCoord - vec2(0.5);
    uvp *= uScale;
    uvp += vec2(0.5);
    vec2 src = (filterMatrixInverse * vec3(uvp, 1.0)).xy;
    vec4 tok = texture2D(uSampler, clamp(src, inputClamp.xy, inputClamp.zw));

    float dist = distance(vFilterCoord, vec2(0.5));

    /* Кромка: красный фильтр от СЕРЕДИНЫ к краям. Висит на ВСЕХ стадиях
     * (накапливается, не пропадает при переходе на следующую). */
    float rim = smoothstep(0.1, 0.55, dist);
    float kRim = clamp(rim * uRim * uFade * tok.a, 0.0, 1.0);
    vec3 c = mix(tok.rgb, uRimColor, kRim);

    /* Кровь: центральное пятно (тяжёлая) + сплэш брызг (средняя и тяжёлая).
     * Обе добавляются ПОВЕРХ кромки и копятся. */
    float center = 1.0 - smoothstep(0.0, 0.45, dist);
    float splash = splashMask(vFilterCoord);
    float pulse = 0.7 + 0.3 * uPulseAmp;
    float kBlood = clamp((center * uCenter + splash * uSplash) * pulse * uFade * tok.a, 0.0, 1.0);
    c = mix(c, uBlood, kBlood);

    gl_FragColor = vec4(c, tok.a);
}
`;

/* --- PIXI.Filter эффекта --- */

const _tempRect = new PIXI.Rectangle();

class Tinyd6DeathFxFilter extends PIXI.Filter {
    constructor({ stage, seed } = {}) {
        super(VERT2D, FRAG, {
            filterMatrix: new PIXI.Matrix(),
            filterMatrixInverse: new PIXI.Matrix(),
            uFade: 0,
            uScale: 1,
            uPulseAmp: 0,
            uRim: 0,
            uSplash: 0,
            uCenter: 0,
            uRimColor: new Float32Array([0.48, 0.02, 0.025]),
            uBlood: new Float32Array([0.24, 0.012, 0.014]),
            uSeed: seed
        });
        this.padding = 0;
        this.autoFit = false;
    }

    /* Общий конверт эффекта (0..1): появление/снятие. */
    get alpha() { return this.uniforms.uFade; }
    set alpha(v) { this.uniforms.uFade = v; }

    /* Вес кромки (сидит на всех стадиях). */
    get rim() { return this.uniforms.uRim; }
    set rim(v) { this.uniforms.uRim = v; }

    /* Вес кровавого сплэша (средняя и тяжёлая стадии). */
    get splash() { return this.uniforms.uSplash; }
    set splash(v) { this.uniforms.uSplash = v; }

    /* Вес центрального пятна-заливки (тяжёлая стадия). */
    get center() { return this.uniforms.uCenter; }
    set center(v) { this.uniforms.uCenter = v; }

    /* Прогресс анимации времени исключён: сплэш статичен, экономии ради. */

    /* Зум-пульс (1 = покой). */
    get pulse() { return this.uniforms.uScale; }
    set pulse(v) { this.uniforms.uScale = v; }

    /* Амплитуда «вспышки» (0..1) для усиления красноты в такт пульсу. */
    get pulseAmp() { return this.uniforms.uPulseAmp; }
    set pulseAmp(v) { this.uniforms.uPulseAmp = v; }

    /* Каждый кадр пересчитываем матрицу фильтра по текущим границам токена
     * (копия TM CustomFilter.apply). */
    apply(filterManager, input, output, clear) {
        const filterMatrix = this.uniforms.filterMatrix;
        const { sourceFrame, destinationFrame, target } = filterManager.activeState;

        filterMatrix.set(destinationFrame.width, 0, 0, destinationFrame.height, sourceFrame.x, sourceFrame.y);

        const worldTransform = PIXI.Matrix.TEMP_MATRIX;
        const localBounds = target.getLocalBounds(_tempRect);

        worldTransform.copyFrom(target.transform.worldTransform);
        worldTransform.invert();
        filterMatrix.prepend(worldTransform);
        filterMatrix.translate(-localBounds.x, -localBounds.y);
        filterMatrix.scale(1.0 / Math.max(localBounds.width, 1e-6), 1.0 / Math.max(localBounds.height, 1e-6));

        const filterMatrixInverse = this.uniforms.filterMatrixInverse;
        filterMatrixInverse.copyFrom(filterMatrix);
        filterMatrixInverse.invert();

        filterManager.applyFilter(this, input, output, clear);
    }
}

/* --- Крепление и снятие фильтра с токена --- */

function _detachFilter(entry) {
    const filter = entry.fx;
    const mesh = entry.tokenMesh;
    if (mesh && !mesh.destroyed && filter)
    {
        const list = mesh.filters;
        if (Array.isArray(list) && list.includes(filter)) mesh.filters = list.filter(f => f !== filter);
    }
    if (filter)
    {
        filter.enabled = false;
        try { filter.destroy(); } catch (err) { /* ignore */ }
    }
    entry.fx = null;
    entry.tokenMesh = null;
    entry.texKey = null;
    entry.ok = false;
}

/* Собирает фильтр для ступени и вешает на mesh токена (мердж, не затирая
 * чужие фильтры вроде fxmaster/tokenmagic). */
function _buildFilter(entry, mesh) {
    const filter = new Tinyd6DeathFxFilter({ stage: entry.stage, seed: entry.seed });

    const list = Array.isArray(mesh.filters) ? mesh.filters : [];
    mesh.filters = [...list, filter];

    entry.fx = filter;
    entry.tokenMesh = mesh;
    entry.texKey = mesh.texture?.key ?? null;
    entry.ok = true;
    entry.phase = 0;
    entry._alphaLogged = false;
    _fxStats.built++;
    console.info("tinyd6 | deathFx built:", { tokenId: entry.tokenId, stage: entry.stage, filtersOnMesh: mesh.filters.length, texKey: entry.texKey });
    if (TRUTH_ON)
    {
        setTimeout(() => _truthReport(entry, mesh), 600);
    }
    return true;
}

/* --- Публичный API (контракты: socket.js, death.js) --- */

/* Плавное затухание и удаление оверлея (стабилизация/смерть/отключение). */
export function removeDeathFx(actorId) {
    const entry = OVERLAYS.get(actorId);
    if (!entry) return;
    entry.removing = true;
    entry.delT = 0;
}

/* Применяет оверлей умирания локально (на текущий canvas).
 * tier: 1-3 ступень подсветки, 0 - убрать. */
export function applyDeathFx({ actorId = null, sceneId = null, tier = 0 } = {}) {
    try {
        if (!actorId) return;
        if (sceneId && sceneId !== game.canvas?.scene?.id) return;
        console.info("tinyd6 | FX >> applyDeathFx", { actorId, tier, sceneId });
        _fxStats.applied++;

        const n = Math.max(0, Math.min(3, Math.round(Number(tier) || 0)));
        if (n === 0) { _fxStats.removed++; removeDeathFx(actorId); return; }
        if (!_animFxEnabled() || !_deathFxEnabled()) { _fxStats.skippedNoFx++; console.info("tinyd6 | FX skipped: animFx or enableDeathFx is off"); removeDeathFx(actorId); return; }

        const token = _resolveToken(actorId);
        if (!token?.mesh) { _fxStats.tokenMissing++; console.warn("tinyd6 | FX no token/mesh for actor:", actorId, "canvas tokens:", canvas.tokens?.placeables?.length ?? 0); removeDeathFx(actorId); return; }
        console.info("tinyd6 | FX token resolved:", { actorId, token: token.id, texKey: token.mesh.texture?.key ?? null });

        const entry = OVERLAYS.get(actorId);
        if (entry)
        {
            /* Смена ступени НЕ пересобирает фильтр: цель весов просто
             * обновляется, и _frame плавно добавляет новый слой поверх. */
            entry.tokenId = token.id;
            entry.stage = n;
            return;
        }

        /* Потолок одновременных эффектов: чтобы толпа из 15 умирающих не
         * клала слабую машину. Достигнут предел - вытесняем самый старый
         * (плавный фейд), а не отказываем новому. */
        if (OVERLAYS.size >= MAX_ACTIVE_EFFECTS)
        {
            let oldest = null;
            for (const e of OVERLAYS.values())
            {
                if (!oldest || e.phase > oldest.phase) oldest = e;
            }
            if (oldest)
            {
                _fxStats.cappedOut++;
                console.warn("tinyd6 | FX cap", MAX_ACTIVE_EFFECTS, "- вытеснено самое старое:", oldest.actorId);
                oldest.removing = true;
                oldest.delT = 0;
            }
        }

        const created = {
            actorId,
            tokenId: token.id,
            stage: n,
            phase: 0,
            ok: false,
            fx: null,
            texKey: null,
            tokenMesh: null,
            seed: Math.random(),
            removing: false,
            delT: 0
        };
        OVERLAYS.set(actorId, created);
        if (!_buildFilter(created, token.mesh)) OVERLAYS.delete(actorId);
    } catch (err) {
        console.warn("tinyd6 | death fx apply skipped:", err);
    }
}

/* --- Анимация (каждый кадр) --- */

/* Длина цикла «сердцебиения» на ступени 3 (мс). */
const PULSE_CYCLE = 1200;
/* Задержка перед началом пульса (мс) - чтобы не дёргаться при появлении. */
const PULSE_START = 700;
/* Максимальный зум-пульс (доля от размера: 0.04 = 4%). */
const PULSE_AMP_MAX = 0.04;

function _frame() {
    if (!OVERLAYS.size) return;
    // На слабых машинах не заставляем перепекать всю сцену каждый кадр:
    // ре-рендер нужен только пока картинка реально меняется (появление,
    // снятие, переход весов, «сердцебиение» на тяжёлой ступени). В
    // стабильный период сплэш статичен и сцена висит в кэше - GPU отдыхает.
    const now = performance.now();
    const dt = canvas?.app?.ticker?.deltaMS || (now - _frameLast) || 16.67;
    _frameLast = now;
    _pulseAccum += dt;
    let needsRedraw = false;
    for (const [actorId, entry] of Array.from(OVERLAYS))
    {
        try {
            const token = _resolveToken(actorId);
            if (!token?.mesh)
            {
                entry.removing = true;
                entry.delT = Math.max(entry.delT, 500);
            }
            else
            {
                const mesh = token.mesh;
                const attached = entry.ok && entry.fx && !mesh.destroyed &&
                    entry.tokenMesh === mesh &&
                    Array.isArray(mesh.filters) && mesh.filters.includes(entry.fx);
                if (!attached)
                {
                    if (entry.ok && entry.fx) _detachFilter(entry);
                    if (!_buildFilter(entry, mesh)) { OVERLAYS.delete(actorId); continue; }
                }
            }

            if (entry.removing) entry.delT += dt;
            const removing = entry.removing;
            const fade = entry.ok ? Math.min(1, entry.phase / 300) : 0;
            entry.phase += dt;

            if (entry.ok && entry.fx)
            {
                const fx = entry.fx;

                /* Мёртв - сердце больше не бьётся: пульс замирает. */
                const actor = token?.actor ?? null;
                const dead = !!actor && actor.system?.death?.dead === true;

                /* Пульс только на ТЯЖЁЛОЙ ступени (1): резкий зум-«удар»
                 * в начале каждого цикла с плавным затуханием. */
                let pulse = 1;
                let pulseAmp = 0;
                if (entry.stage <= 1 && !dead)
                {
                    const pt = entry.phase - PULSE_START;
                    if (pt > 0)
                    {
                        const phCycle = (pt % PULSE_CYCLE) / PULSE_CYCLE;
                        const env = Math.exp(-8 * phCycle); // 1 -> 0 в течение цикла
                        pulseAmp = env;
                        pulse = 1 - PULSE_AMP_MAX * env;
                    }
                }
                fx.pulse = pulse;
                fx.pulseAmp = pulseAmp;

                /* Кумулятивные веса: следующая ступень добавляет поверх,
                 * ничего не убирая; при снятии - всё плавно в 0. */
                const t = removing
                    ? { rim: 0, splash: 0, center: 0 }
                    : (C_TARGETS[entry.stage] || C_TARGETS[3]);
                const rim0 = fx.rim, splash0 = fx.splash, center0 = fx.center;
                fx.rim += (t.rim - fx.rim) * COMP_SMOOTH;
                fx.splash += (t.splash - fx.splash) * COMP_SMOOTH;
                fx.center += (t.center - fx.center) * COMP_SMOOTH;
                const moving = Math.abs(fx.rim - rim0) > 1e-3 ||
                    Math.abs(fx.splash - splash0) > 1e-3 ||
                    Math.abs(fx.center - center0) > 1e-3;

                const cAlpha = removing ? Math.max(0, 1 - entry.delT / 500) : 1;
                const target = fade * cAlpha;
                fx.alpha = Math.max(0, Math.min(1, target));
                if (!entry._alphaLogged)
                {
                    entry._alphaLogged = true;
                    console.info("tinyd6 | FX first frame:", { actorId, dt: +dt.toFixed(1), stage: entry.stage, fade: +fade.toFixed(2), rim: +fx.rim.toFixed(2), splash: +fx.splash.toFixed(2), center: +fx.center.toFixed(2), pulse: +pulse.toFixed(3), dead, filtersOnMesh: entry.tokenMesh?.filters?.length ?? 0 });
                }
                /* Появление/снятие/переход весов - перерисовываем сразу.
                 * ТОЛЬКО пульс (stage<=1, не мёртв) троттлим:
                 * primary перепекается каждые PULSE_DT, а не каждый кадр. */
                if (fade < 1 || cAlpha < 1 || moving)
                    needsRedraw = true;
                else if (entry.stage <= 1 && !dead && _pulseAccum >= PULSE_DT)
                    needsRedraw = true;
                if (removing && cAlpha <= 0)
                {
                    _detachFilter(entry);
                    OVERLAYS.delete(actorId);
                    continue;
                }
            }
            else if (entry.removing)
            {
                OVERLAYS.delete(actorId);
            }
        } catch (err) {
            _fxStats.frameErrors++;
            console.warn("tinyd6 | death fx frame skipped:", err);
        }
    }
    if (needsRedraw)
    {
        if (canvas?.primary) canvas.primary.renderDirty = true;
        _pulseAccum = 0;
    }
}

/* --- Хуки и синхронизация --- */

/* Полный сброс (перезагрузка сцены/канваса). */
function _teardownAll() {
    for (const entry of OVERLAYS.values())
    {
        try { _detachFilter(entry); } catch (err) { /* ignore */ }
    }
    OVERLAYS.clear();
}

/* После загрузки сцены заново подсвечивает умирающих из состояния их
 * актёров (мёртвым возвращает замороженный вид тяжёлой стадии). */
function _syncSceneDeathFx() {
    try {
        const scene = game.canvas?.scene;
        if (!scene || !canvas.tokens) return;
        for (const token of scene.tokens)
        {
            const actor = token.actor ?? null;
            if (!actor || !actor.system?.death) continue;
            if (actor.system?.death?.dead === true)
            {
                applyDeathFx({ actorId: actor.id, sceneId: scene.id, tier: 1 });
                continue;
            }
            if (!actor.system?.death?.dying) continue;
            const left = Number(actor.system?.death?.roundsLeft) || 0;
            if (left > 0) applyDeathFx({ actorId: actor.id, sceneId: scene.id, tier: _tierOf(left) });
        }
    } catch (err) { /* ignore */ }
}

/* Регистрирует таймер анимации и хуки. Вызывается из ready. */
export function initDeathFxHooks() {
    if (!TICKER_ON)
    {
        TICKER_ON = true;
        if (canvas?.app?.ticker) canvas.app.ticker.add(_frame);
        else Hooks.once("canvasReady", () => canvas.app.ticker.add(_frame));
    }

    Hooks.on("canvasReady", () => {
        _teardownAll();
        _syncSceneDeathFx();
    });

    Hooks.on("deleteToken", (doc) => {
        for (const [actorId, entry] of Array.from(OVERLAYS))
        {
            if (entry.tokenId === doc.id) removeDeathFx(actorId);
        }
    });
}