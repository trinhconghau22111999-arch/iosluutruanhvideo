# Photo Sync Hub

Web app (Next.js, chạy như PWA trên iPhone & Android) để:

1. Đăng nhập **nhiều tài khoản Google** cùng lúc (mỗi tài khoản cấp quyền Drive riêng).
2. Mở trang, **tự chọn ảnh/video mới trong tuần** trên máy (qua trình chọn file của hệ điều hành — đây là giới hạn của trình duyệt, không có API nào quét ngầm thư viện ảnh khi app không mở).
3. Bấm **Đồng bộ**: app tự bỏ qua file đã từng đồng bộ, rồi upload từng file vào tài khoản Google Drive đang **còn nhiều dung lượng trống nhất**.
4. Trang **Thư viện**: xem lại toàn bộ ảnh/video đã đồng bộ từ mọi tài khoản, nhóm theo ngày đồng bộ, có thể **Xem / Xoá / Chia sẻ** ngay trên web. Nút **Chia sẻ** tải đúng file ảnh/video gốc về rồi mở hộp thoại chia sẻ của hệ điều hành (Web Share API) — gửi thẳng file thật sang Zalo, Facebook, Messenger... y như chia sẻ từ thư viện ảnh trên máy, không phải gửi link Google Drive.
5. Xoá ảnh gốc trên điện thoại là thao tác **thủ công của người dùng** sau khi đồng bộ xong (trình duyệt không được phép tự xoá ảnh trong Photos/Gallery vì lý do bảo mật hệ điều hành — kể cả Android cũng cần người dùng xác nhận qua hộp thoại hệ thống).

## Vì sao kiến trúc thế này

- **Không dùng Firebase Auth cho việc lấy quyền Drive**, vì Firebase Auth chỉ giữ 1 user đăng nhập / phiên. Để giữ **nhiều tài khoản Google cùng lúc**, app tự làm OAuth 2.0 "Authorization Code" trực tiếp với Google, lưu `refresh_token` của từng tài khoản ở server (Firestore), rồi phía server sinh access token khi cần gọi Drive API. Nhờ vậy user không phải đăng nhập lại mỗi giờ.
- **Firestore (Firebase)** chỉ dùng làm database lưu: danh sách tài khoản đã kết nối (refresh token đã mã hoá) + danh sách file đã đồng bộ (để chống trùng, để hiển thị thư viện).
- **File ảnh/video được tải thẳng từ điện thoại lên Google Drive, không đi qua server của app.** Lý do: các nền tảng hosting miễn phí như Vercel giới hạn cứng mỗi request gửi lên server tối đa khoảng 4.5MB — đủ cho ảnh nhưng gần như luôn nhỏ hơn video thật. Vì vậy luồng tải lên chia làm 2 bước nhỏ:
  1. Trình duyệt gọi `/api/drive/upload/init` (chỉ gửi tên/dung lượng/loại file — vài trăm byte) — server kiểm tra trùng, chọn tài khoản còn trống nhiều nhất, xin Google một "phiên tải lên" (resumable session) rồi trả về địa chỉ phiên đó.
  2. Trình duyệt tự gửi thẳng toàn bộ file tới địa chỉ đó (thẳng tới Google, không qua server app) — không giới hạn dung lượng, kể cả video vài GB. Nếu mạng rớt giữa chừng, app tự hỏi Google đã nhận được bao nhiêu byte và tiếp tục đúng từ chỗ đó, không tải lại từ đầu.
  3. Trình duyệt báo lại `/api/drive/upload/complete` (cũng chỉ vài trăm byte metadata) để lưu vào Firestore cho thư viện.
- Toàn bộ gọi Google Drive API khác (xoá, tải về để xem/chia sẻ) đều đi qua **API route phía server** (Next.js `route.js`) — client không bao giờ cầm access token/refresh token, an toàn hơn.

## Cài đặt

### 1. Google Cloud Console
1. Tạo project mới tại https://console.cloud.google.com
2. Bật **Google Drive API** (APIs & Services → Library → Google Drive API → Enable)
3. Vào **APIs & Services → OAuth consent screen**: chọn External, điền tên app, thêm scope `https://www.googleapis.com/auth/drive.file`
4. Vào **Credentials → Create Credentials → OAuth client ID**, chọn "Web application"
   - Authorized redirect URI: `https://<domain-cua-ban>/api/auth/google/callback` (và thêm `http://localhost:3000/api/auth/google/callback` để test local)
5. Lấy `Client ID` và `Client secret`

### 2. Firebase
1. Tạo project tại https://console.firebase.google.com
2. Bật **Firestore Database** (chế độ Native, chọn 1 region gần bạn)
3. Vào **Project settings → Service accounts → Generate new private key**, tải file JSON

### 3. Biến môi trường
Copy `.env.example` thành `.env.local`, điền:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
APP_BASE_URL=http://localhost:3000
TOKEN_ENCRYPTION_KEY=  # chuỗi ngẫu nhiên 32 ký tự, dùng để mã hoá refresh token trước khi lưu Firestore
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
(3 dòng Firebase lấy từ file JSON service account ở bước 2)

### 4. Chạy thử
```bash
npm install
npm run dev
```
Mở http://localhost:3000

### 5. Đưa lên GitHub
```bash
git init
git add .
git commit -m "Khởi tạo Photo Sync Hub"
git branch -M main
git remote add origin https://github.com/<ban>/photo-sync-hub.git
git push -u origin main
```
Sau đó deploy bằng Vercel (kết nối thẳng repo GitHub, import biến môi trường ở bước 3, nhớ đổi `GOOGLE_REDIRECT_URI`/`APP_BASE_URL` sang domain thật) — Vercel free tier chạy tốt cho app này.

## Luồng sử dụng
1. Mở app lần đầu sẽ vào thẳng **Thư viện** (trang mặc định) — trống trơn cho tới khi bạn kết nối tài khoản và đồng bộ. Vào **Tài khoản** → bấm **"Thêm tài khoản Google"** → lặp lại cho từng tài khoản Gmail muốn dùng để lưu ảnh.
2. Vào **Đồng bộ** → chọn ảnh/video từ máy, tick chọn (hoặc "Chọn tất cả").
3. Bấm **Bắt đầu đồng bộ** → app bỏ qua file trùng, upload phần còn lại, ưu tiên tài khoản trống nhiều nhất, hiện tiến trình từng file.
4. Vào **Thư viện** → xem lại tất cả ảnh/video theo ngày, bấm thẳng vào ảnh/video để xem, hoặc Chia sẻ / Xoá.
5. Tự tay xoá ảnh gốc trên điện thoại (Photos/Gallery) sau khi đã kiểm tra đồng bộ xong.

**Chuyển trang:** vuốt trái/phải trên màn hình để di chuyển qua lại giữa 3 trang theo đúng thứ tự tab (Thư viện → Đồng bộ → Tài khoản), hoặc bấm thẳng vào tên trang trên thanh menu.

## Giới hạn cần biết
- iOS Safari không cho chạy nền / không cho tự động phát hiện ảnh mới khi app đang đóng — luôn cần người dùng tự mở trang và chọn file.
- Trình duyệt (kể cả Android) không có quyền tự xoá ảnh gốc — chỉ con người mới xoá được, qua app Photos/Gallery thật.
- "Lọc theo tuần" dựa vào `lastModified` của file do hệ điều hành cung cấp khi bạn chọn — đúng với hầu hết trường hợp chụp ảnh/quay video gần đây.
- Chia sẻ file thật (không phải link) dùng Web Share API Level 2 (`navigator.share({ files })`). Được hỗ trợ tốt trên Chrome Android và Safari iOS 16.4+. Trên trình duyệt máy tính không hỗ trợ, app sẽ tự tải file về máy để bạn tự đính kèm thủ công.
- Video dung lượng lớn sẽ mất vài giây để tải về trước khi hộp thoại chia sẻ hiện ra, vì file phải đi qua server để lấy từ Drive về trước.
- **Chuyển sang app khác trong lúc đồng bộ:** không có web app nào (kể cả không cài đặt như native app) đảm bảo được 100% việc tiếp tục chạy khi bạn chuyển hẳn sang app khác — hệ điều hành có quyền tạm ngưng tab để tiết kiệm pin, mạnh nhất là trên iPhone, nhẹ tay hơn trên Android. Trang `/sync` có xin "Wake Lock" để giữ màn hình không tắt trong lúc đồng bộ, và mọi tiến trình đều **an toàn để tiếp tục dở dang**: nếu bị gián đoạn (do hệ điều hành ngắt tab, mất mạng...), chỉ cần quay lại trang, chọn lại đúng những file đó — file đã lưu xong sẽ tự động bị bỏ qua (không lưu trùng), chỉ những file chưa xong mới tiếp tục tải lên. Nếu vài file bị lỗi giữa chừng (thường do mất mạng), có nút "Thử lại file lỗi" ngay trên trang, không cần chọn lại từ đầu.
- **Tốc độ đồng bộ:** app tải song song 3 file cùng lúc (thay vì lần lượt từng file) để tận dụng tốt hơn thời gian chờ mạng. Với **nhiều ảnh nhỏ**, chạy song song giúp nhanh rõ rệt. Với **video dung lượng lớn**, tốc độ thật sự vẫn bị giới hạn bởi băng thông tải lên của mạng di động — chạy song song 3 video cùng lúc không giúp tổng thời gian nhanh gấp 3, vì cả 3 vẫn chia nhau chung một đường truyền. Vì vậy nếu chỉ đồng bộ vài video lớn, cắm wifi/mạng khoẻ vẫn là yếu tố quyết định tốc độ nhiều nhất, không phải cấu hình phần mềm.
