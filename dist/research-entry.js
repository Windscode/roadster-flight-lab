// Keep old bookmarks working; ordinary city/lab navigation stays in main.js.
const target=new URL('./',import.meta.url);
target.searchParams.set('view','lab');
location.replace(target.href);
