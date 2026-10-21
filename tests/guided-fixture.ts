export function guidedReply(request: {
  messages: { role: string; content: unknown; tool_call_id?: string }[];
}) {
  const last = request.messages.at(-1)!;
  const call = (name: string, args: unknown) => ({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  });
  if (last.role !== 'tool') return call('review_context', {});
  if (last.tool_call_id === 'review_context') return call('search_knowledge', { query: '二分边界' });
  if (last.tool_call_id === 'search_knowledge')
    return call('review_checkpoint', {
      summary: '已读取题目与二分资料；尚无本机运行报告。',
      hypothesis: '需要检查区间缩小条件，尚未验证。',
      question: '请记录当前发现或说明仍缺少的信息。',
      advance: true,
    });
  return { role: 'assistant', content: '已保存当前检查点，等待你的回答。' };
}
