import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

export const bsodManifest: SaverManifest = {
  id: 'bsod',
  label: 'BSOD',
  passthrough: false,
  minBackend: 'css',
  costTier: 'idle',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'Static text screens, slow crossfade between them.' },
};

const CYCLE_MS = 10_000;
const FADE_MS = 800;

interface Screen {
  id: string;
  html: string;
}

const SCREENS: Screen[] = [
  {
    id: 'win31',
    html: `<div class="is-bsod-win31">
<pre>
Windows

A fatal exception 0E has occurred at 0028:C0034B03
in VXD VWIN32(01) + 00010A45. The current application
will be terminated.

*  Press any key to terminate the current application.
*  Press CTRL+ALT+DEL again to restart your computer.
   You will lose any unsaved information in all applications.

                  Press any key to continue _</pre></div>`,
  },
  {
    id: 'win98',
    html: `<div class="is-bsod-win98">
<pre>
A problem has been detected and Windows has been shut down to prevent
damage to your computer.

DRIVER_IRQL_NOT_LESS_OR_EQUAL

If this is the first time you've seen this Stop error screen,
restart your computer. If this screen appears again, follow these steps:

Check to make sure any new hardware or software is properly installed.
If this is a new installation, ask your hardware or software manufacturer
for any Windows updates you might need.

If problems continue, disable or remove any newly installed hardware or
software. Disable BIOS memory options such as caching or shadowing.
If you need to use Safe Mode to remove or disable components, restart
your computer, press F8 to select Advanced Startup Options, and then
select Safe Mode.

Technical information:

*** STOP: 0x000000D1 (0x0000000C,0x00000002,0x00000000,0xF86B5A89)

***    gv3.sys - Address F86B5A89 base at F86B5000, DateStamp 3dd9919eb</pre></div>`,
  },
  {
    id: 'win10',
    html: `<div class="is-bsod-win10">
<div class="is-bsod-face">:(</div>
<div class="is-bsod-title">Your PC ran into a problem and needs to restart. We're just collecting some error info, and then we'll restart for you.</div>
<div class="is-bsod-pct">68% complete</div>
<div class="is-bsod-detail">
<div class="is-bsod-small">For more information about this issue and possible fixes, visit<br>https://www.windows.com/stopcode</div>
<div class="is-bsod-small">If you call a support person, give them this info:<br>Stop code: CRITICAL_PROCESS_DIED</div>
</div></div>`,
  },
  {
    id: 'panic',
    html: `<div class="is-bsod-panic">
<pre>
panic(cpu 0 caller 0xffffff80003ade41): Kernel trap at 0xffffff7f80a3f6e5,
type 14=page fault, registers:
CR0: 0x000000008001003b, CR2: 0x0000000000000010, CR3: 0x000000000600f000,
CR4: 0x00000000001626e0
RAX: 0x0000000000000003, RBX: 0xffffff80175c9000, RCX: 0xffffff8017403310,
RDX: 0x0000000000000000
RSP: 0xffffff8116e63c30, RBP: 0xffffff8116e63c60, RSI: 0xffffff80175c9000,
RDI: 0x0000000000000001
R8:  0x0000000000000000, R9:  0x00000000000003ff, R10: 0x0000000000000008,
R11: 0x0000000000000206
R12: 0x0000000000000000, R13: 0x0000000000000001, R14: 0x0000000000000000,
R15: 0x0000000000000000
RFL: 0x0000000000010202, RIP: 0xffffff7f80a3f6e5, CS:  0x0000000000000008,
SS:  0x0000000000000010

Backtrace (CPU 0), Frame : Return Address
0xffffff8116e63880 : 0xffffff80002c3ae1
0xffffff8116e63900 : 0xffffff80003ade41
0xffffff8116e63ae0 : 0xffffff80003c9576
0xffffff8116e63b00 : 0xffffff80002a4f10


You need to restart your computer.
Hold down the Power button for several seconds or
press the Restart button.</pre></div>`,
  },
  {
    id: 'amiga',
    html: `<div class="is-bsod-amiga">
<div class="is-bsod-amiga-alert">
  <span class="is-bsod-amiga-icon"></span>
  <div class="is-bsod-amiga-text">
    Software Failure.    Press left mouse button to continue.<br>
    Guru Meditation #48454C50.0BADF00D
  </div>
</div></div>`,
  },
];

const CSS = `
.is-bsod-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.is-bsod-screen {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
}
.is-bsod-screen.is-active { opacity: 1; }
.is-bsod-root.is-paused .is-bsod-screen { transition: none; }

/* Win 3.1 / 9x */
.is-bsod-win31, .is-bsod-win98 {
  width: 100%; height: 100%;
  background: #0000aa;
  color: #aaa;
  font-family: 'Courier New', 'Lucida Console', monospace;
  font-size: clamp(10px, 1.4vw, 16px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.is-bsod-win31 pre, .is-bsod-win98 pre {
  margin: 0;
  padding: 2em;
  max-width: 80ch;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
.is-bsod-win31 { color: #fff; }

/* Win 10/11 */
.is-bsod-win10 {
  width: 100%; height: 100%;
  background: #0078d7;
  color: #fff;
  font-family: 'Segoe UI', system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 10%;
  box-sizing: border-box;
}
.is-bsod-face {
  font-size: clamp(60px, 12vw, 140px);
  font-weight: 200;
  line-height: 1;
  margin-bottom: 0.3em;
}
.is-bsod-title {
  font-size: clamp(14px, 2.2vw, 26px);
  line-height: 1.4;
  max-width: 50ch;
}
.is-bsod-pct {
  font-size: clamp(14px, 2.2vw, 26px);
  margin-top: 1em;
}
.is-bsod-detail { margin-top: 2em; }
.is-bsod-small {
  font-size: clamp(10px, 1.2vw, 14px);
  line-height: 1.6;
  margin-top: 0.8em;
  opacity: 0.9;
}

/* macOS kernel panic */
.is-bsod-panic {
  width: 100%; height: 100%;
  background: #000;
  color: #fff;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: clamp(9px, 1.2vw, 14px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.is-bsod-panic pre {
  margin: 0;
  padding: 2em;
  max-width: 90ch;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}

/* Amiga Guru Meditation */
.is-bsod-amiga {
  width: 100%; height: 100%;
  background: #000;
  color: #f00;
  font-family: 'Courier New', 'Lucida Console', monospace;
  display: flex;
  align-items: center;
  justify-content: center;
}
.is-bsod-amiga-alert {
  border: 3px solid #f00;
  padding: 0.8em 1.5em;
  display: flex;
  align-items: center;
  gap: 1em;
}
.is-bsod-amiga-icon {
  display: inline-block;
  width: 1.2em;
  height: 1.2em;
  border: 2px solid #f00;
  border-radius: 50%;
  flex-shrink: 0;
}
.is-bsod-amiga-text {
  font-size: clamp(12px, 1.8vw, 20px);
  line-height: 1.6;
}
`;

class BsodInstance implements SaverInstance {
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly screens: HTMLElement[];
  private current = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: SaverContext) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    ctx.host.appendChild(this.style);

    this.root = document.createElement('div');
    this.root.className = 'is-bsod-root';
    this.root.setAttribute('aria-hidden', 'true');

    this.screens = SCREENS.map((s) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'is-bsod-screen';
      wrapper.dataset['screen'] = s.id;
      wrapper.innerHTML = s.html;
      this.root.appendChild(wrapper);
      return wrapper;
    });

    ctx.host.appendChild(this.root);
    this.show(0);

    if (ctx.reducedMotion) {
      this.root.classList.add('is-paused');
    } else {
      this.startCycle();
    }
  }

  private show(idx: number): void {
    for (let i = 0; i < this.screens.length; i++) {
      this.screens[i]!.classList.toggle('is-active', i === idx);
    }
    this.current = idx;
  }

  private advance(): void {
    this.show((this.current + 1) % this.screens.length);
  }

  private startCycle(): void {
    if (this.timerId !== null) return;
    this.timerId = setInterval(() => this.advance(), CYCLE_MS);
  }

  private stopCycle(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('is-paused', paused);
    if (paused) {
      this.stopCycle();
    } else {
      this.startCycle();
    }
  }

  resize(_width: number, _height: number): void {}

  dispose(): void {
    this.stopCycle();
    this.root.remove();
    this.style.remove();
  }
}

export const bsod: SaverPlugin = {
  manifest: bsodManifest,
  mount: (ctx: SaverContext) => new BsodInstance(ctx),
};
