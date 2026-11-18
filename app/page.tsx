'use client';

import dynamic from 'next/dynamic';
import { controlInput } from '@/lib/input';

const Scene = dynamic(() => import('@/components/Scene'), { ssr: false });

type Key = keyof typeof controlInput;

function PadButton({ k, label }: { k: Key; label: string }) {
  const set = (v: boolean) => () => {
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
        <p>W / S sail &nbsp; A / D rudder &nbsp; drag to look</p>
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
      </div>
    </main>
  );
}
