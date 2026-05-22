function summarizeText(input) {
  if (!input || typeof input.text !== 'string' || input.text.trim().length === 0) {
    throw new Error('ACTION_EXECUTION_FAILED: input.text is required for summarize.text.');
  }

  const normalized = input.text.replace(/\s+/g, ' ').trim();
  const sentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized;
  return {
    summary: sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence
  };
}

function executeMockAgentAction(action, input) {
  if (action !== 'summarize.text') {
    throw new Error(`ACTION_EXECUTION_FAILED: unsupported action ${action}.`);
  }

  return summarizeText(input);
}

module.exports = {
  executeMockAgentAction
};
