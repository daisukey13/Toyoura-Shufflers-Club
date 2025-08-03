cat > components/BackgroundVideo.tsx << 'EOF'
'use client';

export default function BackgroundVideo() {
  return (
    <div className="fixed inset-0 z-0">
      <video
        autoPlay
        loop
        muted
        className="absolute z-0 w-auto min-w-full min-h-full max-w-none"
      >
        <source
          src="/videos/shuffleboard-bg.mp4"
          type="video/mp4"
        />
        Your browser does not support the video tag.
      </video>
      <div className="absolute inset-0 bg-black opacity-50 z-10"></div>
    </div>
  );
}
EOF