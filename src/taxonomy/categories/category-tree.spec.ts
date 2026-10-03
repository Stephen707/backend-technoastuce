import { Types } from 'mongoose';
import { buildCategoryTree, CategoryTreeRecord } from './category-tree';

function record(
  name: string,
  parent: Types.ObjectId | null = null,
  position = 0,
): CategoryTreeRecord {
  return {
    _id: new Types.ObjectId(),
    name,
    slug: name.toLowerCase(),
    parent,
    position,
  };
}

describe('buildCategoryTree', () => {
  it('nests children under their parent, keeping input order', () => {
    const windows = record('Windows');
    const linux = record('Linux');
    const tips = record('Tips', windows._id);
    const registry = record('Registry', tips._id);
    const drivers = record('Drivers', windows._id);

    const tree = buildCategoryTree([windows, linux, tips, registry, drivers]);

    expect(tree.map((n) => n.name)).toEqual(['Windows', 'Linux']);
    expect(tree[0].children.map((n) => n.name)).toEqual(['Tips', 'Drivers']);
    expect(tree[0].children[0].children.map((n) => n.name)).toEqual([
      'Registry',
    ]);
    expect(tree[1].children).toEqual([]);
  });

  it('attaches a child listed before its parent', () => {
    const parent = record('Parent');
    const child = record('Child', parent._id);
    const [root] = buildCategoryTree([child, parent]);
    expect(root.children[0].id).toBe(child._id.toHexString());
  });

  it('drops orphans and their subtree instead of promoting them to roots', () => {
    const orphan = record('Orphan', new Types.ObjectId());
    const grandChild = record('GrandChild', orphan._id);
    const root = record('Root');
    expect(buildCategoryTree([orphan, grandChild, root])).toEqual([
      expect.objectContaining({ name: 'Root' }),
    ]);
  });

  it('exposes only public fields', () => {
    const [node] = buildCategoryTree([record('Windows')]);
    expect(Object.keys(node).sort()).toEqual(
      ['children', 'description', 'id', 'name', 'position', 'slug'].sort(),
    );
  });
});
