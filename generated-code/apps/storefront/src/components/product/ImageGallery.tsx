'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ProductImage } from '@/types/product';

interface ImageGalleryProps {
  images: ProductImage[];
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div className="aspect-square w-full bg-zinc-100 rounded-lg flex items-center justify-center text-zinc-500">
        No image available
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Main Image */}
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-100 border border-zinc-200">
        <Image
          src={images[activeIndex].url}
          alt={images[activeIndex].alt}
          fill
          className="object-cover object-center"
          priority
        />
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {images.map((image, index) => (
            <button
              key={index}
              onClick={() => setActiveIndex(index)}
              className={`relative aspect-square w-20 flex-shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                activeIndex === index ? 'border-blue-600' : 'border-transparent hover:border-zinc-300'
              }`}
            >
              <Image
                src={image.url}
                alt={`Thumbnail ${index + 1}`}
                fill
                className="object-cover object-center"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
