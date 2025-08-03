// components/BackgroundVideo.tsx

'use client';

import { useState, useEffect } from 'react';

export default function BackgroundVideo() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // モバイル検出
    const checkMobile = (https://cpfyaezsyvjjwpbuhewa.supabase.co/storage/v1/object/public/videos//shufflers.mp4) => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // モバイルの場合は静止画背景
  if (isMobile) {
    return (
      <div className="fixed inset-0 -z-10">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/images/shuffleboard-bg.jpg)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/80 via-purple-900/60 to-black/80" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 -z-10">
      {/* 動画読み込み前のフォールバック */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900 to-black" />
      )}
      
      <video
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={() => setIsLoaded(true)}
        className={`absolute min-w-full min-h-full object-cover transition-opacity duration-1000 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <source src="/videos/shuffleboard-ambient.webm" type="video/webm" />
        <source src="/videos/shuffleboard-ambient.mp4" type="video/mp4" />
      </video>
      
      {/* グラデーションオーバーレイ */}
      <div className="absolute inset-0 bg-gradient-to-b from-purple-900/40 via-transparent to-black/60" />
      
      {/* 追加のエフェクトレイヤー */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      
      {/* アニメーションする光のエフェクト */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-pink-500 rounded-full blur-3xl animate-pulse animation-delay-2000" />
      </div>
    </div>
  );
}