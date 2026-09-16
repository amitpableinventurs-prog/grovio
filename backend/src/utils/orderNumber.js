function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `GRV-${ts}-${rand}`;
}

module.exports = generateOrderNumber;
