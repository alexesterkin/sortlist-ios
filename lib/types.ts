// Domain types mirrored from the sortlist.shop backend. These describe the
// shapes we read off tRPC responses; we don't import the AppRouter so we
// keep these as the source of truth for the client.

export type User = {
  id: number;
  openId?: string;
  name: string | null;
  email: string;
  loginMethod?: string;
  role?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  lastSignedIn?: Date | string | null;
  avatarUrl?: string | null;
};

export type Collection = {
  id: number;
  userId?: number;
  name: string;
  description?: string | null;
  itemCount?: number;
  manuallyNamed?: boolean;
  coverImageUrl?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type ProductStatus = 'active' | 'archived' | 'purchased' | string;

export type Product = {
  id: number;
  userId?: number;
  collectionId: number | null;
  url: string;
  title: string | null;
  price: string | null;
  imageUrl: string | null;
  siteName: string | null;
  notes: string | null;
  status: ProductStatus;
  tags?: { id: number; name: string }[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type MetaFetchResult = {
  title: string;
  brand: string;
  price: string;
  currency?: string;
  imageUrl: string;
  siteName: string;
  confidence?: number;
  extraction_method?: string;
  blocked_message?: string | null;
};
