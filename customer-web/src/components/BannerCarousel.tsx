import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Banner } from '../types';
import { resolveAssetUrl } from '../api/client';

// Where tapping a banner goes (admin sets linkType / linkValue).
function BannerLink({ banner, children }: { banner: Banner; children: ReactNode }) {
  const v = banner.linkValue;
  if (banner.linkType === 'product' && v) return <Link to={`/products/${v}`} className="block h-full">{children}</Link>;
  if (banner.linkType === 'category' && v) return <Link to={`/products?categoryId=${v}`} className="block h-full">{children}</Link>;
  if (banner.linkType === 'url' && v) return <a href={v} target="_blank" rel="noreferrer" className="block h-full">{children}</a>;
  return <div className="h-full">{children}</div>;
}

// Home page offer banners. The whole image is always shown (object-contain) — banners come in
// different shapes, so the frame is sized for the usual 2.3:1 banner and anything else is fitted
// inside on a blurred copy of itself instead of being cropped.
export default function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = banners.length;

  useEffect(() => {
    if (count <= 1 || paused) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % count), 4500);
    return () => clearInterval(timer);
  }, [count, paused]);

  if (count === 0) return null;

  // The banner list can shrink under us; never point past its end.
  const current = active < count ? active : 0;
  const go = (step: number) => setActive((i) => ((i < count ? i : 0) + step + count) % count);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-100"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; setPaused(true); }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        setPaused(false);
        if (start === null) return;
        const dx = e.changedTouches[0].clientX - start;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${current * 100}%)` }}>
        {banners.map((banner, i) => {
          const src = resolveAssetUrl(banner.image);
          return (
            <div key={banner._id} className="relative aspect-[23/10] max-h-[440px] w-full shrink-0 overflow-hidden" aria-hidden={i !== current}>
              <BannerLink banner={banner}>
                {/* Soft fill behind banners that aren't 2.3:1 */}
                <img src={src} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" draggable={false} />
                <img
                  src={src}
                  alt={banner.title || 'Offer banner'}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                  className="relative h-full w-full object-contain"
                />
              </BannerLink>
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous banner"
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md hover:bg-white sm:flex"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label="Next banner"
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md hover:bg-white sm:flex"
          >
            <ChevronRight size={18} />
          </button>
          <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/25 px-2 py-1 backdrop-blur-sm">
            {banners.map((banner, i) => (
              <button
                key={banner._id}
                type="button"
                aria-label={`Go to banner ${i + 1}`}
                aria-current={i === current}
                onClick={() => setActive(i)}
                className={`h-1.5 rounded-full transition-all ${i === current ? 'w-5 bg-white' : 'w-1.5 bg-white/60'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
