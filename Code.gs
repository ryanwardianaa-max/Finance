/**
 * Google Apps Script - REST API untuk Aplikasi Personal Finance
 * 
 * PETUNJUK PEMASANGAN (INDONESIAN INSTRUCTIONS):
 * 1. Buka Google Sheets (Buat spreadsheet baru jika belum ada).
 * 2. Klik menu "Extensions" (Ekstensi) -> "Apps Script".
 * 3. Hapus semua kode default di editor, lalu paste kode ini.
 * 4. Klik ikon Save (Simpan).
 * 5. Klik tombol "Deploy" di kanan atas -> Pilih "New deployment".
 * 6. Klik ikon Gear (Setelan) di sebelah "Select type", pilih "Web app".
 * 7. Pada bagian:
 *    - Description: Tulis deskripsi bebas (misal: Personal Finance API).
 *    - Execute as: Pilih "Me (email_anda@gmail.com)".
 *    - Who has access: Pilih "Anyone" (Siapa saja). Ini PENTING agar API bisa diakses dari web app.
 * 8. Klik "Deploy". Google akan meminta otorisasi akses spreadsheet, klik "Authorize access" dan pilih akun Anda.
 *    (Jika ada peringatan keamanan "Google hasn't verified this app", klik "Advanced" -> "Go to Untitled project (unsafe)").
 * 9. Salin "Web app URL" yang muncul (Format: https://script.google.com/macros/s/.../exec).
 * 10. Paste URL tersebut di variabel `GAS_WEB_APP_URL` pada file `app.js`.
 */

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Transactions");
  if (!sheet) {
    sheet = ss.insertSheet("Transactions");
    // Buat header kolom
    sheet.appendRow(["ID", "Date", "User Email", "Amount", "Category", "Type", "Description"]);
    // Format header agar rapi
    sheet.getRange("A1:G1").setFontWeight("bold").setBackground("#f3f4f6").setHorizontalAlignment("center");
  }
  return sheet;
}

// Menangani permintaan GET (Membaca Transaksi)
function doGet(e) {
  var sheet = setupSheet();
  var action = e.parameter.action;
  var email = e.parameter.email;
  
  if (!email) {
    return createJsonResponse({ status: "error", message: "Parameter 'email' wajib diisi" }, 400);
  }
  
  try {
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var transactions = [];
    
    // Looping baris data (lewati baris 1 / header)
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      // Filter transaksi berdasarkan email pengguna
      if (row[2] === email) {
        var dateFormatted = "";
        if (row[1] instanceof Date) {
          // Format tanggal ke YYYY-MM-DD
          var d = row[1];
          var month = '' + (d.getMonth() + 1);
          var day = '' + d.getDate();
          var year = d.getFullYear();
          if (month.length < 2) month = '0' + month;
          if (day.length < 2) day = '0' + day;
          dateFormatted = [year, month, day].join('-');
        } else {
          dateFormatted = row[1];
        }
        
        transactions.push({
          id: row[0],
          date: dateFormatted,
          email: row[2],
          amount: parseFloat(row[3]) || 0,
          category: row[4],
          type: row[5],
          description: row[6]
        });
      }
    }
    
    // Urutkan transaksi berdasarkan tanggal terbaru
    transactions.sort(function(a, b) {
      return new Date(b.date) - new Date(a.date);
    });
    
    return createJsonResponse({ status: "success", data: transactions });
  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() }, 500);
  }
}

// Menangani permintaan POST (Menambah/Menghapus Transaksi)
function doPost(e) {
  var lock = LockService.getScriptLock();
  // Kunci script selama maks 15 detik agar antrean penulisan data aman
  try {
    lock.waitLock(15000);
  } catch (error) {
    return createJsonResponse({ status: "error", message: "Gagal mengunci spreadsheet, silakan coba lagi." }, 408);
  }
  
  try {
    var sheet = setupSheet();
    var postData;
    
    if (e.postData && e.postData.contents) {
      postData = JSON.parse(e.postData.contents);
    } else {
      return createJsonResponse({ status: "error", message: "Body request kosong" }, 400);
    }
    
    var action = postData.action;
    
    if (action === "addTransaction") {
      var id = Utilities.getUuid();
      var date = postData.date || new Date().toISOString().substring(0, 10);
      var email = postData.email;
      var amount = parseFloat(postData.amount) || 0;
      var category = postData.category || "Lainnya";
      var type = postData.type || "expense"; // "income" atau "expense"
      var description = postData.description || "";
      
      if (!email) {
        return createJsonResponse({ status: "error", message: "Parameter 'email' wajib diisi" }, 400);
      }
      
      sheet.appendRow([id, date, email, amount, category, type, description]);
      
      return createJsonResponse({ 
        status: "success", 
        message: "Transaksi berhasil ditambahkan",
        data: { id: id, date: date, email: email, amount: amount, category: category, type: type, description: description }
      });
      
    } else if (action === "deleteTransaction") {
      var idToDelete = postData.id;
      var email = postData.email;
      
      if (!idToDelete || !email) {
        return createJsonResponse({ status: "error", message: "Parameter 'id' dan 'email' wajib diisi" }, 400);
      }
      
      var data = sheet.getDataRange().getValues();
      var foundRow = -1;
      
      for (var i = 1; i < data.length; i++) {
        // Cocokkan ID dan Email pemilik
        if (data[i][0] === idToDelete && data[i][2] === email) {
          foundRow = i + 1; // Baris di Google Sheet dimulai dari 1
          break;
        }
      }
      
      if (foundRow !== -1) {
        sheet.deleteRow(foundRow);
        return createJsonResponse({ status: "success", message: "Transaksi berhasil dihapus" });
      } else {
        return createJsonResponse({ status: "error", message: "Transaksi tidak ditemukan atau hak akses ditolak" }, 404);
      }
      
    } else {
      return createJsonResponse({ status: "error", message: "Aksi tidak dikenal" }, 400);
    }
    
  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() }, 500);
  } finally {
    lock.releaseLock();
  }
}

// Fungsi bantu untuk memformat respon menjadi JSON dengan CORS header
function createJsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
    
  return output;
}
