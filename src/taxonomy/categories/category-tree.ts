import { CategoryRecord, CategoryTreeNode } from './categories.types';

export type CategoryTreeRecord = Pick<
  CategoryRecord,
  '_id' | 'name' | 'slug' | 'description' | 'parent' | 'position'
>;

/**
 * Builds the nested tree from a flat list in O(n), keeping the input order
 * among siblings (read the records sorted by position). A record whose
 * parent is not in the list is dropped with its subtree rather than shown
 * at the root, so a partial read can't misplace categories.
 */
export function buildCategoryTree(
  records: CategoryTreeRecord[],
): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>();
  for (const r of records) {
    nodes.set(r._id.toHexString(), {
      id: r._id.toHexString(),
      name: r.name,
      slug: r.slug,
      description: r.description,
      position: r.position,
      children: [],
    });
  }

  const roots: CategoryTreeNode[] = [];
  for (const r of records) {
    const node = nodes.get(r._id.toHexString())!;
    if (!r.parent) {
      roots.push(node);
      continue;
    }
    nodes.get(r.parent.toHexString())?.children.push(node);
  }
  return roots;
}
