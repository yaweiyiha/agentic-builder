'use client';

import React, { useState, useRef, useEffect } from 'react';
import algoliasearch from 'algoliasearch/lite';
import {
  InstantSearch,
  useSearchBox,
  useHits,
  Configure,
} from 'react-instantsearch';
import { Search, X, Loader2, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

// Initialize Algolia client
// Fallback to dummy values to prevent crash during build/dev if env vars are missing
const searchClient = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID || 'demo_app_id',
  process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY || 'demo_search_key'
);

const INDEX_NAME = process.env.NEXT_PUBLIC_ALGOLIA_INDEX_NAME || 'products';

interface ProductHit {
  objectID: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  category: string;
  url: string;
}

function SearchInput({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
}) {
  const { query, refine, clear } = useSearchBox();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    clear();
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Search className="h-5 w-5 text-zinc-400" aria-hidden="true" />
      </div>
      <input
        ref={inputRef}
        type="text"
        className="block w-full pl-10 pr-10 py-2.5 border border-zinc-200 rounded-lg leading-5 bg-zinc-100 placeholder-zinc-500 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-600 focus:border-blue-600 sm:text-sm transition-colors duration-200"
        placeholder="Search for products, categories, or brands..."
        value={query}
        onChange={(e) => {
          refine(e.currentTarget.value);
          if (!isOpen && e.currentTarget.value.trim().length > 0) {
            setIsOpen(true);
          }
        }}
        onFocus={() => {
          if (query.trim().length > 0) {
            setIsOpen(true);
          }
        }}
      />
      {query.length > 0 && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SearchResults({ closeDropdown }: { closeDropdown: () => void }) {
  const { hits } = useHits<ProductHit>();
  const { query } = useSearchBox();

  if (!query) return null;

  return (
    <div className="absolute z-50 w-full mt-2 bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden origin-top animate-in fade-in slide-in-from-top-2 duration-200">
      {hits.length === 0 ? (
        <div className="p-6 text-center">
          <Search className="mx-auto h-8 w-8 text-zinc-300 mb-3" />
          <p className="text-sm text-zinc-900 font-medium">No results found</p>
          <p className="text-xs text-zinc-500 mt-1">
            We couldn't find anything matching "{query}"
          </p>
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
          <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-100">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Products
            </h3>
          </div>
          <ul className="divide-y divide-zinc-100">
            {hits.map((hit) => (
              <li key={hit.objectID}>
                <Link
                  href={`/products/${hit.objectID}`}
                  onClick={closeDropdown}
                  className="flex items-center gap-4 p-4 hover:bg-blue-50 transition-colors group"
                >
                  <div className="relative h-14 w-14 flex-shrink-0 rounded-md bg-zinc-100 border border-zinc-200 overflow-hidden">
                    {hit.imageUrl ? (
                      <Image
                        src={hit.imageUrl}
                        alt={hit.name}
                        fill
                        className="object-cover"
                        sizes="56px"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <ShoppingBag className="h-6 w-6 text-zinc-300" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-700 transition-colors">
                      {hit.name}
                    </p>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {hit.category}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-sm font-semibold text-zinc-900">
                      ${(hit.price || 0).toFixed(2)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="p-3 bg-zinc-50 border-t border-zinc-100 text-center">
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              onClick={closeDropdown}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              View all results &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    // Handle escape key to close dropdown
    function handleEscapeKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl mx-auto">
      <InstantSearch searchClient={searchClient} indexName={INDEX_NAME}>
        {/* Configure semantic search and typo tolerance via Algolia dashboard, 
            but we can enforce some frontend limits here */}
        <Configure hitsPerPage={5} />
        
        <SearchInput isOpen={isOpen} setIsOpen={setIsOpen} />
        
        {isOpen && <SearchResults closeDropdown={() => setIsOpen(false)} />}
      </InstantSearch>
    </div>
  );
}
