import { Types } from 'mongoose';

// Shape of a lean document read with CATEGORY_PROJECTION.
export interface CategoryRecord {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  parent: Types.ObjectId | null;
  ancestors: Types.ObjectId[];
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryView {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parentId: string | null;
  // 1 for a root category.
  depth: number;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryCrumb {
  id: string;
  name: string;
  slug: string;
}

// A single category with its breadcrumb (root first, excluding itself).
export interface CategoryDetailView extends CategoryView {
  path: CategoryCrumb[];
}

export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  description?: string;
  position: number;
  children: CategoryTreeNode[];
}

export interface CategoryListFilters {
  search?: string;
  // `null` = root categories only.
  parent?: Types.ObjectId | null;
}
