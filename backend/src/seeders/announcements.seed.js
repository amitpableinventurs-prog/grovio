// Sample notices for delivery partners (Updates tab). Run: npm run seed:announcements
// Safe to run again — each notice has a fixed key and is only created once.
require('dotenv').config();
const { connectDB, mongoose } = require('../config/db');
const { Announcement } = require('../models');

const NOTICES = [
  {
    key: 'notice-eph',
    title: 'महत्वपूर्ण सूचना: EPH (Earnings Per Hour)',
    category: 'earnings',
    body: `प्रिय Delivery Partner,

EPH (Earnings Per Hour) का अर्थ है प्रति घंटे की कमाई।
Grovio का payout system पूरी तरह EPH के आधार पर काम करता है।

**EPH बढ़ाने के लिए ज़रूरी निर्देश:**
* सप्ताह में कम से कम 6 दिन Login करना।
* प्रतिदिन 9–10 घंटे का Login time बनाए रखना।
* शनिवार और रविवार Login करना।
* Morning या Evening में से किसी एक Peak Hours में Login करना।
* Daily Offers की सभी conditions पूरी करना।
* किसी भी प्रकार की fraud गतिविधि में शामिल न होना।

**सरल शब्दों में:**
अपनी EPH बढ़ाने के लिए आपको ज़्यादा समय Login रहना, Peak Hours में काम करना, और सभी Offers की conditions पूरी करना है।

आज ही सही समय पर और ज़्यादा से ज़्यादा Login करना प्रारंभ करें और अपनी कमाई को ज़्यादा से ज़्यादा बढ़ाएँ।

धन्यवाद,
Team Grovio`,
  },
  {
    key: 'notice-cod',
    title: 'महत्वपूर्ण सूचना: COD Orders',
    category: 'payments',
    requireAck: true,
    pinned: true,
    body: `प्रिय डिलीवरी पार्टनर्स,

**COD (Cash on Delivery) Orders से संबंधित महत्वपूर्ण सूचना**

सभी डिलीवरी पार्टनर्स से अनुरोध है कि COD Orders की डिलीवरी के दौरान नीचे दिए गए प्रोसेस का ध्यानपूर्वक पालन करें:

जब आप Customer Location पर पहुंचकर Reach Drop करते हैं, तो सबसे पहले यह जांच लें कि Order COD है या नहीं।

Reach Drop के बाद यदि App में Collect Payment from Customer का संदेश दिखाई देता है, तो Order Deliver करने से पहले Customer से Payment अवश्य Collect करें।

Payment के दो तरीके हो सकते हैं:

**1. Cash Payment**
* Customer से Cash प्राप्त करें।
* App में Collect Cash का विकल्प चुनकर Payment Confirm करें।
* Payment Confirm होने के बाद ही Order को Delivered Mark करें।
* प्राप्त Cash को Store वापस आकर Store Manager के पास जमा करें।

**2. Online Payment**
* यदि Customer Online Payment करना चाहता है, तो App में Company का QR Code दिखाई देगा।
* Customer से उसी QR Code पर Payment करवाएं।
* इस स्थिति में Payment सीधे Company Account में जमा हो जाती है।
* Payment Successful होने के बाद ही Order को Delivered Mark करें।

**महत्वपूर्ण:**
यदि आप Payment Collect किए बिना Order को Delivered Mark कर देते हैं और Store वापस आ जाते हैं, तो संबंधित Amount आपके Wallet से Deduct हो सकती है।

इसलिए किसी भी स्थिति में Payment Collect किए बिना Order Deliver न करें।

यदि आपको Process से संबंधित कोई भी Doubt या Issue हो, तो तुरंत अपने Fleet Coach या Store Manager से संपर्क करें।

सही Process अपनाएं, सुरक्षित रहें और अनावश्यक Wallet Deductions से बचें।

धन्यवाद
Team Grovio!`,
  },
  {
    key: 'notice-fast-delivery',
    title: 'तेज़ डिलीवरी = ज़्यादा कमाई',
    category: 'process',
    body: `प्रिय डिलीवरी पार्टनर,

ग्राहक तक ऑर्डर समय पर पहुँचाना हमारी सबसे बड़ी जिम्मेदारी है। बेहतर सेवा और अधिक कमाई के लिए कृपया नीचे दिए गए निर्देशों का पालन करें:

• मोबाइल पर ऑर्डर आते ही बिना देरी के तुरंत Accept करें और Billing Table पर पहुँचें।
• Picker द्वारा ऑर्डर Hand Over होते ही किसी भी प्रकार की देरी न करें। ऑर्डर को अपने Grocery Bag में सुरक्षित रखें और तुरंत ग्राहक की लोकेशन के लिए निकल जाएँ।
• स्टोर पर Drop Zone उपलब्ध होने पर वहाँ अनावश्यक समय न बिताएँ। जल्दी डिलीवरी पूरी करें ताकि आप अधिक ऑर्डर लेकर अपनी कमाई बढ़ा सकें।
• बारिश के दौरान हमेशा अपना Raincoat साथ रखें और ऑर्डर मिलते ही तुरंत डिलीवरी के लिए रवाना हों।

**महत्वपूर्ण:**
ऑर्डर मिलने के बाद स्टोर पर व्यर्थ समय बिताना आपकी Performance पर सीधा असर डालता है। लगातार देरी पाए जाने पर आपकी ID पर कार्रवाई भी की जा सकती है।

**याद रखें:**
Billing/Hand Over होने के बाद हर मिनट की देरी ग्राहक के अनुभव को प्रभावित करती है। इसलिए ऑर्डर मिलते ही बिना रुके ग्राहक की ओर प्रस्थान करें।

**तेज़ डिलीवरी = खुश ग्राहक = ज़्यादा ऑर्डर = ज़्यादा कमाई**`,
  },
  {
    key: 'notice-mdnd',
    title: 'महत्वपूर्ण सूचना: MDND',
    category: 'safety',
    requireAck: true,
    body: `**MDND (Mark Delivered But Not Delivered)** एक बहुत गलत प्रैक्टिस है। इससे हमारे ग्राहकों का अनुभव खराब होता है और कंपनी की सेवा गुणवत्ता पर भी नकारात्मक प्रभाव पड़ता है।

यदि आप किसी ऑर्डर की डिलीवरी करते समय ग्राहक को रोड, पार्क या किसी ऐसी जगह पर पार्सल देते हैं जहाँ उसका घर या सही पता उपलब्ध नहीं है, तो ग्राहक आपके सामने मौजूद होने पर भी डिलीवरी मार्क करने से पहले एक बार कॉल के माध्यम से पुष्टि अवश्य करें। इससे यह सुनिश्चित होगा कि पार्सल सही ग्राहक तक पहुँचे।

**कॉल द्वारा पुष्टि करने के फायदे**
* पार्सल सही ग्राहक तक पहुँचेगा।
* ग्राहक का अनुभव बेहतर होगा।
* अनावश्यक शिकायतों से बचाव होगा।
* पेनल्टी लगने की संभावना कम होगी।

**महत्वपूर्ण चेतावनी**

**Penalty Risk**
यदि किसी मामले में डिलीवरी बॉय की गलती पाई जाती है, तो आइटम वैल्यू के बराबर पेनल्टी लगाई जा सकती है।

कृपया हमेशा ध्यान रखें अपनी आईडी और कमाई को सुरक्षित रखें।

आपकी सावधानी न केवल ग्राहक के अनुभव को बेहतर बनाती है, बल्कि आपकी आईडी और भविष्य की कमाई को भी सुरक्षित रखती है।

धन्यवाद`,
  },
];

async function run() {
  await connectDB();
  let created = 0;
  for (const n of NOTICES) {
    const res = await Announcement.updateOne(
      { key: n.key },
      { $setOnInsert: { ...n, audience: { roles: ['delivery'], stores: [], users: [] }, status: 'published', publishedAt: new Date(), sendPush: false } },
      { upsert: true },
    );
    if (res.upsertedCount) created += 1;
  }
  console.log(`Notices: ${created} created, ${NOTICES.length - created} already there.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { NOTICES };
