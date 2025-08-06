// components/VirtualList.tsx

import { useRef, useEffect, useState, useCallback } from 'react';

interface VirtualListProps {
  items: any[];
  height: number;
  itemHeight: number;
  renderItem: (index: number) => React.ReactNode;
  className?: string;
  overscan?: number;
}

export default function VirtualList({
  items,
  height,
  itemHeight,
  renderItem,
  className = '',
  overscan = 3
}: VirtualListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + height) / itemHeight) + overscan
  );

  const visibleItems = [];
  for (let i = startIndex; i <= endIndex; i++) {
    visibleItems.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          top: i * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight
        }}
      >
        {renderItem(i)}
      </div>
    );
  }

  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
  }, []);

  useEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) return;

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div
      ref={scrollElementRef}
      className={`relative overflow-auto ${className}`}
      style={{ height }}
    >
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        {visibleItems}
      </div>
    </div>
  );
}