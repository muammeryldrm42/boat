'use client';

import dynamic from 'next/dynamic';

const Scene = dynamic(() => import('@/components/Scene'), { ssr: false });

export default function Page() {
  return (
    <main>
      <Scene />
      <div className="hud">
        <b>Ghost Galleon</b>
        drag to orbit / scroll to zoom
      </div>
    </main>
  );
}
