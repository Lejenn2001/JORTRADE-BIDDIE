// Video Template - Replace ReplitLoadingScene with your scenes

import { AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './scenes/Scene1';
import { Scene2 } from './scenes/Scene2';
import { Scene3 } from './scenes/Scene3';
import { Scene4 } from './scenes/Scene4';
import { Scene5 } from './scenes/Scene5';

const SCENE_DURATIONS = {
  scene1: 7000,
  scene2: 15000,
  scene3: 12000,
  scene4: 12000,
  scene5: 8000,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({
    durations: SCENE_DURATIONS,
  });

  return (
    <div className="w-screen h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-dark)' }}>
    <div
      className="overflow-hidden relative"
      style={{ 
        backgroundColor: 'var(--color-bg-dark)',
        aspectRatio: '9 / 16',
        height: '100vh',
        maxWidth: '100vw',
      }}
    >
      <AnimatePresence mode="wait">
        {currentScene === 0 && <Scene1 key="scene1" />}
        {currentScene === 1 && <Scene2 key="scene2" />}
        {currentScene === 2 && <Scene3 key="scene3" />}
        {currentScene === 3 && <Scene4 key="scene4" />}
        {currentScene === 4 && <Scene5 key="scene5" />}
      </AnimatePresence>
    </div>
    </div>
  );
}
