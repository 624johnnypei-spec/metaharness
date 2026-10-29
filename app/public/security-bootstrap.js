// Runs before the router bundle. Web does not accept credentials through URLs.
// Clear accidental query/fragment credentials from the current history entry;
// a static host may already have received the original request, so never share
// browser links containing a token.
(() => {
  if (location.search || location.hash) history.replaceState(null, "", location.pathname);
})();
