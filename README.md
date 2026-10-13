# חתימות ועד הבית

דף לחתימת דיירים על אישור מורשת החתימה בחשבון הבנק של ועד הבית, מתחם נחום גולדמן 1–9 בבאר שבע.

הדף מאוחסן ב-GitHub Pages. כל חתימה נשמרת בקובץ `signatures.json` בריפו הזה, בלי מסד נתונים.

האתר: https://timur-krasner-ri.github.io/vaad-sign/

## הפעלה חד-פעמית

אירוח חינמי ב-GitHub Pages עובד על ריפו ציבורי. השמות, מספרי הדירות והחתימות יהיו גלויים למי שיש לו את הקישור.

1. Settings → General → Change visibility → Public.
2. צרו [Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) רק לריפו `vaad-sign`, עם הרשאת Contents: Read and write, ובלי הרשאות נוספות.
3. Settings → Secrets and variables → Actions → New repository secret. השם: `SIGN_TOKEN`.
4. Settings → Pages → Source: GitHub Actions.
5. Actions → Deploy site → Run workflow.

הטוקן נכתב לקובץ `config.js` רק באתר שמתפרסם, כדי שהדפדפן יוכל לשמור חתימה ישר לריפו. מי שפותח את קוד האתר יכול לשלוח או לערוך חתימות בריפו הזה בלבד.
