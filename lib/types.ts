// Domain types mirrored from the sortlist.shop backend. These describe the
// shapes we read off tRPC responses; we don't import the AppRouter so we
// keep these as the source of truth for the client.

export type User = {
  id: string | number;
  name: string | null;
  email: string;
  avatarUrl?: string | null;
};

export type Collection = {
  id: number;
  name: string;
  productCount?: number;
  manuallyNamed?: boolean;
  coverImageUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ProductStatus = 'wishlist' | 'purchased' | 'archived' | string;

export type Product = {
  id: number;
  url: string;
  title: string | null;
  price: string | null;
  imageUrl: string | null;
  siteName: string | null;
  status: ProductStatus;
  collectionId: number | null;
  notes?: string | null;
  brand?: string | null;
  createdAt?: string;
};

export type MetaFetchResult = {
  title: string;
  imageUrl: string;
  price: string;
  siteName: string;
  blocked_message?: string | null;
};
