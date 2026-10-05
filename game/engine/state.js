/* Pure state transitions: shared by browser and Node tests. No DOM or network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VNState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(story) {
    return {schema: 1, storyId: story.id, storyVersion: story.version, node: story.start, beat: 0, history: [], visited: [story.start], endings: [], completed: false, updated: Date.now()};
  }
  function validate(value, story) {
    const map = new Map(story.nodes.map(n => [n.id, n]));
    if (!value || value.schema !== 1 || value.storyId !== story.id || value.storyVersion !== story.version || !map.has(value.node)) throw new Error('存档与当前故事版本不兼容。');
    for (const key of ['history', 'visited', 'endings']) {
      if (!Array.isArray(value[key]) || value[key].length > 20000 || value[key].some(id => typeof id !== 'string' || !map.has(id))) throw new Error('存档数据不完整。');
    }
    if (value.endings.some(id => map.get(id).type !== 'ending')) throw new Error('结局记录无效。');
    const beatCount = map.get(value.node).beats?.length || 1;
    const beat = Number.isInteger(value.beat) ? Math.max(0,Math.min(value.beat,beatCount-1)) : 0;
    return {schema: 1, storyId: story.id, storyVersion: story.version, node: value.node, beat, history: value.history.slice(), visited: [...new Set(value.visited)], endings: [...new Set(value.endings)], completed: value.completed === true, updated: Number.isFinite(value.updated) ? value.updated : Date.now()};
  }
  function move(state, id, story, push = true) {
    const node = story.nodes.find(n => n.id === id);
    if (!node) throw new Error('剧情节点不存在：' + id);
    const next = {...state, node: id, beat: 0, history: push ? [...state.history, state.node].slice(-2000) : state.history.slice(), visited: [...new Set([...state.visited, id])], endings: state.endings.slice(), updated: Date.now()};
    if (node.type === 'ending' && !next.endings.includes(id)) next.endings.push(id);
    if (node.type === 'complete') next.completed = true;
    return next;
  }
  function choose(state, index, story) {
    const node = story.nodes.find(n => n.id === state.node);
    if (node.type !== 'choice' || !Number.isInteger(index) || !node.options[index]) throw new Error('当前不能选择这个选项。');
    return move(state, node.options[index].next, story);
  }
  function advance(state, story) {
    const node = story.nodes.find(n => n.id === state.node);
    return node.type === 'passage' ? move(state, node.next, story) : state;
  }
  function back(state, story) {
    if (!state.history.length) return state;
    const history = state.history.slice();
    const id = history.pop();
    return move({...state, history}, id, story, false);
  }
  function retry(state, story) {
    const node = story.nodes.find(n => n.id === state.node);
    if (node.type !== 'ending') return state;
    const index = state.history.lastIndexOf(node.retryTo);
    return move({...state, history: index < 0 ? [] : state.history.slice(0, index)}, node.retryTo, story, false);
  }
  return {create, validate, move, choose, advance, back, retry};
});
