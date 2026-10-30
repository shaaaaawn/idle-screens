import { describe, expect, it } from 'vitest';
import { dracoPathProblem, fishUrlProblem } from './fetch-origin';

const PAGE = 'https://idlescreens.com/channel/lobby';
const PKG = 'https://idlescreens.com/assets/';
const PKG_DRACO = `${PKG}draco/`;
const CDN_PKG = 'https://cdn.example/npm/@idle-screens/saver-metaquarium@0.19.1/dist/';

describe('dracoPathProblem', () => {
  it('allows the default, the page origin and the shipped decoder', () => {
    expect(dracoPathProblem('', PAGE, PKG_DRACO)).toBeNull();
    expect(dracoPathProblem('/draco/', PAGE, PKG_DRACO)).toBeNull();
    expect(dracoPathProblem('https://idlescreens.com/other/draco', PAGE, PKG_DRACO)).toBeNull();
    // The package served from a CDN: its own decoder dir, not the whole CDN.
    expect(dracoPathProblem(`${CDN_PKG}draco/`, PAGE, `${CDN_PKG}draco/`)).toBeNull();
    expect(dracoPathProblem('https://cdn.example/npm/evil-pkg/draco/', PAGE, `${CDN_PKG}draco/`)).not.toBeNull();
  });

  it('refuses a foreign host, a scheme or port change, and URLs nobody serves', () => {
    expect(dracoPathProblem('https://evil.example/', PAGE, PKG_DRACO)).toMatch(/runs as script/);
    expect(dracoPathProblem('//evil.example/draco/', PAGE, PKG_DRACO)).not.toBeNull();
    expect(dracoPathProblem('http://idlescreens.com/draco/', PAGE, PKG_DRACO)).not.toBeNull();
    expect(dracoPathProblem('https://idlescreens.com:8443/draco/', PAGE, PKG_DRACO)).not.toBeNull();
    expect(dracoPathProblem('data:text/javascript,alert(1)//', PAGE, PKG_DRACO)).not.toBeNull();
    expect(dracoPathProblem('javascript:alert(1)', PAGE, PKG_DRACO)).not.toBeNull();
  });

  it('reads a blob: URL by the origin it embeds', () => {
    expect(dracoPathProblem('blob:https://idlescreens.com/1234-5678/', PAGE, PKG_DRACO)).toBeNull();
    expect(dracoPathProblem('blob:https://evil.example/1234-5678/', PAGE, PKG_DRACO)).not.toBeNull();
    expect(dracoPathProblem('blob:blob:https://idlescreens.com/x/', PAGE, PKG_DRACO)).not.toBeNull();
  });

  it('off-DOM (no page), only the shipped decoder passes', () => {
    expect(dracoPathProblem('/draco/', null, PKG_DRACO)).not.toBeNull();
    expect(dracoPathProblem(PKG_DRACO, null, PKG_DRACO)).toBeNull();
    expect(dracoPathProblem('https://evil.example/', null, null)).not.toBeNull();
  });

  it('a file:// host (the Mac app) keeps its relative decoder; an opaque "null" origin is not a match', () => {
    const macPage = 'file:///Applications/Idle.app/Contents/Resources/web/index.html';
    expect(dracoPathProblem('assets/draco/', macPage, null)).toBeNull();
    expect(dracoPathProblem('https://evil.example/', macPage, null)).not.toBeNull();
    expect(dracoPathProblem('data:,x', 'data:text/html,<p>', null)).not.toBeNull();
  });
});

describe('fishUrlProblem', () => {
  it('allows the package schemes, the asset mirror, the page origin and the package dir', () => {
    expect(fishUrlProblem('', PAGE, PKG)).toBeNull();
    expect(fishUrlProblem('ipfs://QmaHbEQAP6k2zopJHJBzyaK62zNX5yH8yASDjkaG4DY9Dp/fish_257_of_the_metaquarium_3d.glb', PAGE, PKG)).toBeNull();
    expect(fishUrlProblem('mq-breed:shark', PAGE, PKG)).toBeNull();
    expect(fishUrlProblem('mq-minted:257', PAGE, PKG)).toBeNull();
    expect(fishUrlProblem('https://assets.idlescreens.com/ipfs/Qm/x.glb', PAGE, PKG)).toBeNull();
    expect(fishUrlProblem('/assets/metaquarium/fish-257-angelfish.glb', 'http://localhost:5177/', PKG)).toBeNull();
    expect(fishUrlProblem(`${CDN_PKG}shark.glb`, PAGE, CDN_PKG)).toBeNull();
    expect(fishUrlProblem(`${CDN_PKG}shark.glb`, PAGE, CDN_PKG.slice(0, -1))).toBeNull();
  });

  it('refuses a foreign host, a non-https mirror, credentials and a ported mirror', () => {
    expect(fishUrlProblem('https://evil.example/x.glb', PAGE, PKG)).toMatch(/assets\.idlescreens\.com/);
    expect(fishUrlProblem('http://assets.idlescreens.com/x.glb', PAGE, PKG)).not.toBeNull();
    expect(fishUrlProblem('https://u:p@assets.idlescreens.com/x.glb', PAGE, PKG)).not.toBeNull();
    expect(fishUrlProblem('https://assets.idlescreens.com:444/x.glb', PAGE, PKG)).not.toBeNull();
    expect(fishUrlProblem('https://assets.idlescreens.com.evil.example/x.glb', PAGE, PKG)).not.toBeNull();
    expect(fishUrlProblem('https://cdn.example/npm/evil/x.glb', PAGE, CDN_PKG)).not.toBeNull();
    expect(fishUrlProblem('data:model/gltf-binary;base64,AAAA', PAGE, PKG)).not.toBeNull();
    expect(fishUrlProblem('ipfs://Qm/../x.glb', PAGE, PKG)).not.toBeNull();
    expect(fishUrlProblem('not a url', null, null)).not.toBeNull();
  });
});
