'use client';

import dynamic from 'next/dynamic';
import { controlInput } from '@/lib/input';

const Scene = dynamic(() => import('@/components/Scene'), { ssr: false });

type Key = keyof typeof controlInput;

function PadButton({ k, label }: { k: Key; label: string }) {
  const fire = k === 'fireLeft' || k === 'fireRight';
  const set = (v: boolean) => () => {
    if (fire && !v) return;
    controlInput[k] = v;
  };
  return (
    <button
      className="pad"
      onPointerDown={set(true)}
      onPointerUp={set(false)}
      onPointerLeave={set(false)}
      onPointerCancel={set(false)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
    >
      {label}
    </button>
  );
}

export default function Page() {
  return (
    <main>
      <Scene />
      <div className="hud">
        <b>Galleon</b>
        <div className="row"><span>Speed</span><em><i id="hud-speed">0.0</i> kn</em></div>
        <div className="row"><span>Heading</span><em><i id="hud-heading">000</i>&deg;</em></div>
        <div className="row"><span>Sail</span><em id="hud-sail">0%</em></div>
        <div className="row"><span>Wind</span><em id="hud-wind">-</em></div>
        <div className="row" style={{ cursor: 'pointer', pointerEvents: 'auto' }} onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }))}><span>Time (T)</span><em id="hud-tod">NIGHT</em></div>
        <div className="row" style={{ cursor: 'pointer', pointerEvents: 'auto' }} onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }))}><span>Sound (M)</span><em id="hud-snd">ON</em></div>
        <p>W / S sail &nbsp; A / D rudder &nbsp; Q / E broadside &nbsp; T time &nbsp; M sound &nbsp; drag to look</p>
      </div>
      <div className="compass" aria-hidden>
        <div className="compass-ring">
          <div id="hud-arrow" className="wind-arrow" />
          <div className="ship-dot" />
        </div>
        <span>wind</span>
      </div>
      <div className="pads">
        <div className="pad-col"><PadButton k="sailUp" label="+" /><PadButton k="sailDown" label="-" /></div>
        <div className="pad-col"><PadButton k="left" label="<" /><PadButton k="right" label=">" /></div>
        <div className="pad-col"><PadButton k="fireLeft" label="Q" /><PadButton k="fireRight" label="E" /></div>
      </div>
    </main>
  );
}
