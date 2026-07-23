import { EXAMPLE_BY_ID, type SaverSpec, type LayerSpec, type SpriteSpec, type MotionSpec } from '@idle-screens/schema';

export interface LayersHandle {
  setSaver(id: string): void;
  onSpecChange: ((spec: SaverSpec) => void) | null;
  dispose(): void;
}

const SPRITE_KINDS: readonly SpriteSpec['kind'][] = ['circle', 'ring', 'streak', 'rect', 'emoji', 'text'];
const MOTION_TYPES: readonly MotionSpec['type'][] = ['drift', 'rise', 'bounce', 'static', 'orbit', 'wander', 'warp', 'path'];

function cloneSpec(spec: SaverSpec): SaverSpec {
  return JSON.parse(JSON.stringify(spec));
}

function defaultSprite(kind: SpriteSpec['kind']): SpriteSpec {
  switch (kind) {
    case 'circle': return { kind: 'circle', radius: [0.003, 0.008], color: '#ffffff' };
    case 'ring': return { kind: 'ring', radius: [0.005, 0.012], color: '#ffffff', width: 0.001 };
    case 'streak': return { kind: 'streak', length: [0.01, 0.03], color: '#ffffff', width: 0.001 };
    case 'rect': return { kind: 'rect', width: [0.005, 0.015], color: '#ffffff' };
    case 'emoji': return { kind: 'emoji', glyphs: ['⭐'] };
    case 'text': return { kind: 'text', strings: ['hello'], color: '#ffffff' };
  }
}

function defaultMotion(type: MotionSpec['type']): MotionSpec {
  switch (type) {
    case 'drift': return { type: 'drift', speed: [0.02, 0.05] };
    case 'rise': return { type: 'rise', speed: [0.02, 0.04] };
    case 'bounce': return { type: 'bounce', speed: [0.03, 0.06] };
    case 'static': return { type: 'static' };
    case 'orbit': return { type: 'orbit', speed: [10, 30], radius: [0.05, 0.15] };
    case 'wander': return { type: 'wander', speed: [0.01, 0.03] };
    case 'warp': return { type: 'warp', speed: [0.3, 0.6] };
    case 'path': return { type: 'path', points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], duration: 5000 };
  }
}

export function buildLayersPanel(mount: HTMLElement): LayersHandle {
  mount.innerHTML = `<div class="layers-wrap">
    <div class="layers-empty">Select a schema saver to edit layers</div>
    <div class="layers-list" hidden></div>
    <button class="layers-add wb-btn wb-btn-primary" hidden type="button">+ Add Layer</button>
  </div>`;

  const emptyEl = mount.querySelector('.layers-empty') as HTMLElement;
  const listEl = mount.querySelector('.layers-list') as HTMLElement;
  const addBtn = mount.querySelector('.layers-add') as HTMLButtonElement;

  let spec: SaverSpec | null = null;
  let specChangeCallback: ((spec: SaverSpec) => void) | null = null;
  let debounceId = 0;

  const notify = (): void => {
    if (!spec || !specChangeCallback) return;
    clearTimeout(debounceId);
    debounceId = window.setTimeout(() => { specChangeCallback?.(cloneSpec(spec!)); }, 150);
  };

  const makeField = (label: string, control: HTMLElement): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'layer-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    row.append(lbl, control);
    return row;
  };

  const numInput = (value: number, opts: { min?: number; max?: number; step?: number }, onChange: (v: number) => void): HTMLInputElement => {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'wb-input layer-num';
    inp.value = String(value);
    if (opts.min !== undefined) inp.min = String(opts.min);
    if (opts.max !== undefined) inp.max = String(opts.max);
    if (opts.step !== undefined) inp.step = String(opts.step);
    inp.addEventListener('input', () => { onChange(Number(inp.value)); notify(); });
    return inp;
  };

  const rangeInput = (pair: [number, number], opts: { step?: number; min?: number; max?: number }, onChange: (v: [number, number]) => void): HTMLElement => {
    const wrap = document.createElement('span');
    wrap.className = 'layer-range';
    const a = numInput(pair[0], opts, (v) => { pair[0] = v; onChange(pair); });
    const sep = document.createElement('span');
    sep.textContent = '–';
    sep.className = 'layer-range-sep';
    const b = numInput(pair[1], opts, (v) => { pair[1] = v; onChange(pair); });
    wrap.append(a, sep, b);
    return wrap;
  };

  const selectField = <T extends string>(value: T, options: readonly T[], onChange: (v: T) => void): HTMLSelectElement => {
    const sel = document.createElement('select');
    sel.className = 'wb-input wb-select';
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt || 'none';
      if (opt === value) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => { onChange(sel.value as T); notify(); });
    return sel;
  };

  const colorField = (value: string, onChange: (v: string) => void): HTMLElement => {
    const wrap = document.createElement('span');
    wrap.className = 'layer-color-wrap';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'layer-color';
    try { picker.value = value; } catch { picker.value = '#ffffff'; }
    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'wb-input layer-color-text';
    text.value = value;
    picker.addEventListener('input', () => { text.value = picker.value; onChange(picker.value); notify(); });
    text.addEventListener('change', () => { try { picker.value = text.value; } catch { /* skip */ } onChange(text.value); notify(); });
    wrap.append(picker, text);
    return wrap;
  };

  const textField = (value: string, onChange: (v: string) => void): HTMLInputElement => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'wb-input layer-text';
    inp.value = value;
    inp.addEventListener('input', () => { onChange(inp.value); notify(); });
    return inp;
  };

  const checkField = (value: boolean, onChange: (v: boolean) => void): HTMLInputElement => {
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.checked = value;
    inp.addEventListener('change', () => { onChange(inp.checked); notify(); });
    return inp;
  };

  const sectionLabel = (text: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'layer-section-label';
    el.textContent = text;
    return el;
  };

  const buildSpriteFields = (layer: LayerSpec, container: HTMLElement): void => {
    container.innerHTML = '';
    const s = layer.sprite;

    if (s.kind === 'circle' || s.kind === 'ring') {
      container.append(
        makeField('Color', colorField(s.color, (v) => { (layer.sprite as typeof s).color = v; })),
        makeField('Radius', rangeInput([...s.radius], { step: 0.0005, min: 0 }, (v) => { (layer.sprite as typeof s).radius = v; })),
      );
      if (s.kind === 'circle') {
        container.append(makeField('Soft', checkField(s.soft ?? false, (v) => { (layer.sprite as Extract<SpriteSpec, { kind: 'circle' }>).soft = v || undefined; })));
      }
      if (s.kind === 'ring') {
        container.append(makeField('Stroke', numInput(s.width ?? 0.001, { step: 0.0005, min: 0 }, (v) => { (layer.sprite as Extract<SpriteSpec, { kind: 'ring' }>).width = v; })));
      }
    } else if (s.kind === 'streak') {
      container.append(
        makeField('Color', colorField(s.color, (v) => { (layer.sprite as typeof s).color = v; })),
        makeField('Length', rangeInput([...s.length], { step: 0.001, min: 0 }, (v) => { (layer.sprite as typeof s).length = v; })),
        makeField('Width', numInput(s.width ?? 0.001, { step: 0.0005, min: 0 }, (v) => { (layer.sprite as typeof s).width = v; })),
      );
    } else if (s.kind === 'rect') {
      container.append(
        makeField('Color', colorField(s.color, (v) => { (layer.sprite as typeof s).color = v; })),
        makeField('Width', rangeInput([...s.width], { step: 0.001, min: 0 }, (v) => { (layer.sprite as typeof s).width = v; })),
      );
      if (s.aspect) {
        container.append(makeField('Aspect', rangeInput([...s.aspect], { step: 0.1, min: 0.1 }, (v) => { (layer.sprite as typeof s).aspect = v; })));
      }
    } else if (s.kind === 'emoji') {
      container.append(makeField('Glyphs', textField(s.glyphs.join(' '), (v) => { (layer.sprite as typeof s).glyphs = v.split(/\s+/).filter(Boolean); })));
    } else if (s.kind === 'text') {
      container.append(
        makeField('Strings', textField(s.strings.join(', '), (v) => { (layer.sprite as typeof s).strings = v.split(',').map((x) => x.trim()).filter(Boolean); })),
        makeField('Color', colorField(s.color ?? '#ffffff', (v) => { (layer.sprite as typeof s).color = v; })),
      );
    }
  };

  const buildMotionFields = (layer: LayerSpec, container: HTMLElement): void => {
    container.innerHTML = '';
    const m = layer.motion;

    if ('speed' in m) {
      container.append(makeField('Speed', rangeInput([...(m as { speed: [number, number] }).speed], { step: 0.001, min: 0 }, (v) => { (layer.motion as { speed: [number, number] }).speed = v; })));
    }

    if (m.type === 'drift') {
      container.append(makeField('Angle', numInput(m.angle ?? 0, { step: 5 }, (v) => { (layer.motion as typeof m).angle = v; })));
      if (m.bob !== undefined) container.append(makeField('Bob', numInput(m.bob, { step: 0.0005, min: 0 }, (v) => { (layer.motion as typeof m).bob = v; })));
      if (m.bidirectional !== undefined) container.append(makeField('Bidir', checkField(m.bidirectional, (v) => { (layer.motion as typeof m).bidirectional = v; })));
    } else if (m.type === 'rise') {
      if (m.sway !== undefined) container.append(makeField('Sway', numInput(m.sway, { step: 0.001, min: 0 }, (v) => { (layer.motion as typeof m).sway = v; })));
    } else if (m.type === 'orbit') {
      container.append(makeField('Radius', rangeInput([...m.radius], { step: 0.01, min: 0 }, (v) => { (layer.motion as typeof m).radius = v; })));
    } else if (m.type === 'wander') {
      if (m.angle !== undefined) container.append(makeField('Angle', numInput(m.angle, { step: 5 }, (v) => { (layer.motion as typeof m).angle = v; })));
      if (m.meander !== undefined) container.append(makeField('Meander', numInput(m.meander, { step: 0.005, min: 0 }, (v) => { (layer.motion as typeof m).meander = v; })));
      if (m.coherence !== undefined) container.append(makeField('Coherence', numInput(m.coherence, { step: 0.05, min: 0, max: 1 }, (v) => { (layer.motion as typeof m).coherence = v; })));
    } else if (m.type === 'path') {
      container.append(makeField('Duration', numInput(m.duration, { step: 500, min: 100 }, (v) => { (layer.motion as typeof m).duration = v; })));
    }
  };

  const buildLayerCard = (layer: LayerSpec, idx: number): HTMLElement => {
    const card = document.createElement('details');
    card.className = 'layer-card';
    card.open = idx === 0;

    const head = document.createElement('summary');
    head.className = 'layer-card-head';

    const idxEl = document.createElement('span');
    idxEl.className = 'layer-idx';
    idxEl.textContent = String(idx);

    const kindBadge = document.createElement('span');
    kindBadge.className = 'layer-badge layer-badge-kind';
    kindBadge.textContent = layer.sprite.kind;

    const motionBadge = document.createElement('span');
    motionBadge.className = 'layer-badge layer-badge-motion';
    motionBadge.textContent = layer.motion.type;

    const keyEl = document.createElement('span');
    keyEl.className = 'layer-key';
    keyEl.textContent = layer.key ?? '';

    const spacer = document.createElement('span');
    spacer.className = 'layer-spacer';

    const countEl = document.createElement('span');
    countEl.className = 'layer-count';
    countEl.textContent = `×${layer.count}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'layer-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove layer';
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!spec) return;
      spec.layers.splice(idx, 1);
      renderAll();
      notify();
    });

    head.append(idxEl, kindBadge, motionBadge, keyEl, spacer, countEl, removeBtn);

    const body = document.createElement('div');
    body.className = 'layer-card-body';

    body.append(makeField('Key', textField(layer.key ?? '', (v) => { layer.key = v || undefined; keyEl.textContent = v; })));
    body.append(makeField('Count', numInput(layer.count, { min: 1, max: 400, step: 1 }, (v) => { layer.count = v; countEl.textContent = `×${v}`; })));

    if (layer.size) {
      body.append(makeField('Size', rangeInput([...layer.size], { step: 0.001, min: 0 }, (v) => { layer.size = v; })));
    }

    body.append(sectionLabel('sprite'));
    const spriteFields = document.createElement('div');
    body.append(makeField('Kind', selectField(layer.sprite.kind, SPRITE_KINDS, (v) => {
      layer.sprite = defaultSprite(v);
      kindBadge.textContent = v;
      buildSpriteFields(layer, spriteFields);
    })));
    body.append(spriteFields);
    buildSpriteFields(layer, spriteFields);

    body.append(sectionLabel('motion'));
    const motionFields = document.createElement('div');
    body.append(makeField('Type', selectField(layer.motion.type, MOTION_TYPES, (v) => {
      layer.motion = defaultMotion(v);
      motionBadge.textContent = v;
      buildMotionFields(layer, motionFields);
    })));
    body.append(motionFields);
    buildMotionFields(layer, motionFields);

    body.append(sectionLabel('style'));
    body.append(makeField('Alpha', rangeInput(layer.alpha ? [...layer.alpha] : [1, 1], { step: 0.05, min: 0, max: 1 }, (v) => { layer.alpha = v; })));
    body.append(makeField('Blend', selectField(
      (layer.blend ?? '') as string,
      ['', 'lighter', 'screen', 'multiply'],
      (v) => { layer.blend = (v || undefined) as LayerSpec['blend']; },
    )));
    if (layer.spin !== undefined) {
      body.append(makeField('Spin', numInput(layer.spin, { step: 1 }, (v) => { layer.spin = v; })));
    }

    card.append(head, body);
    return card;
  };

  const renderAll = (): void => {
    listEl.innerHTML = '';
    if (!spec) return;
    spec.layers.forEach((layer, idx) => {
      listEl.append(buildLayerCard(layer, idx));
    });
  };

  addBtn.addEventListener('click', () => {
    if (!spec) return;
    spec.layers.push({ count: 20, sprite: defaultSprite('circle'), motion: defaultMotion('drift') });
    renderAll();
    notify();
    const last = listEl.querySelector('.layer-card:last-child') as HTMLDetailsElement | null;
    if (last) {
      last.open = true;
      last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  return {
    setSaver(id: string) {
      clearTimeout(debounceId);
      const orig = EXAMPLE_BY_ID[id] as SaverSpec | undefined;
      if (!orig) {
        spec = null;
        emptyEl.hidden = false;
        emptyEl.textContent = 'Not a schema saver';
        listEl.hidden = true;
        addBtn.hidden = true;
        return;
      }
      spec = cloneSpec(orig);
      emptyEl.hidden = true;
      listEl.hidden = false;
      addBtn.hidden = false;
      renderAll();
    },

    get onSpecChange() { return specChangeCallback; },
    set onSpecChange(cb: ((spec: SaverSpec) => void) | null) { specChangeCallback = cb; },

    dispose() {
      clearTimeout(debounceId);
      mount.innerHTML = '';
    },
  };
}
