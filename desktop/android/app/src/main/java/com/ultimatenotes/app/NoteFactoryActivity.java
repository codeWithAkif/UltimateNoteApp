package com.ultimatenotes.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Environment;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class NoteFactoryActivity extends AppCompatActivity {
    private EditText input;
    private TextView chipFolder, chipNote, chipTodo, chipTags;
    private TextView btnSave;
    private BottomSheetDialog bottomSheet;

    private String parsedFolder = null;
    private String parsedNote = null;
    private boolean isTodo = false;
    private List<String> parsedTags = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        View emptyView = new View(this);
        setContentView(emptyView);

        Intent intent = getIntent();
        String prefill = intent.getStringExtra("prefill");

        bottomSheet = new BottomSheetDialog(this);
        bottomSheet.setContentView(R.layout.activity_note_factory);
        
        View bottomSheetLayout = bottomSheet.findViewById(com.google.android.material.R.id.design_bottom_sheet);
        if (bottomSheetLayout != null) {
            bottomSheetLayout.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        }

        bottomSheet.setOnDismissListener(dialog -> finish());

        if (bottomSheet.getWindow() != null) {
            bottomSheet.getWindow().setSoftInputMode(
                android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE |
                android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            );
        }

        input = bottomSheet.findViewById(R.id.note_factory_input);
        chipFolder = bottomSheet.findViewById(R.id.chip_folder);
        chipNote = bottomSheet.findViewById(R.id.chip_note);
        chipTodo = bottomSheet.findViewById(R.id.chip_todo);
        chipTags = bottomSheet.findViewById(R.id.chip_tags);
        btnSave = bottomSheet.findViewById(R.id.btn_note_factory_save);

        TextView btnInsertFolder = bottomSheet.findViewById(R.id.btn_insert_folder);
        TextView btnInsertNote = bottomSheet.findViewById(R.id.btn_insert_note);
        TextView btnInsertTag = bottomSheet.findViewById(R.id.btn_insert_tag);
        TextView btnInsertTodo = bottomSheet.findViewById(R.id.btn_insert_todo);

        if (prefill != null) {
            input.setText(prefill);
            input.setSelection(prefill.length());
            btnSave.setTextColor(0xff38bdf8);
            btnSave.setClickable(true);
        }

        input.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                String val = s.toString();
                if (!val.trim().isEmpty()) {
                    btnSave.setTextColor(0xff38bdf8);
                    btnSave.setClickable(true);
                } else {
                    btnSave.setTextColor(0xff64748b);
                    btnSave.setClickable(false);
                }
                parseInput(val);
            }

            @Override
            public void afterTextChanged(Editable s) {}
        });

        btnInsertFolder.setOnClickListener(v -> insertText("@"));
        btnInsertNote.setOnClickListener(v -> insertText("!"));
        btnInsertTag.setOnClickListener(v -> insertText("#"));
        btnInsertTodo.setOnClickListener(v -> {
            String text = input.getText().toString();
            if (!text.toLowerCase().contains("#todo")) {
                if (!text.endsWith(" ") && !text.isEmpty()) {
                    input.append(" #todo");
                } else {
                    input.append("#todo");
                }
            }
        });

        btnSave.setOnClickListener(v -> {
            String text = input.getText().toString().trim();
            if (!text.isEmpty()) {
                saveNoteToFile(text);
            }
            bottomSheet.dismiss();
        });

        bottomSheet.show();
        parseInput(input.getText().toString());
    }

    private void insertText(String str) {
        int start = input.getSelectionStart();
        int end = input.getSelectionEnd();
        String current = input.getText().toString();
        boolean needsSpace = start > 0 && current.charAt(start - 1) != ' ';
        String insert = needsSpace ? " " + str : str;
        input.getText().replace(Math.min(start, end), Math.max(start, end), insert, 0, insert.length());
    }

    private void parseInput(String raw) {
        parsedFolder = null;
        parsedNote = null;
        isTodo = raw.toLowerCase().contains("#todo") || raw.contains("[ ]");
        parsedTags.clear();

        Pattern folderPat = Pattern.compile("@([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ/\\-]+|\\[[a-zA-Z0-9_ ğüşıöçĞÜŞİÖÇ/\\-]+\\])");
        Matcher folderMat = folderPat.matcher(raw);
        if (folderMat.find()) {
            String f = folderMat.group(1);
            parsedFolder = f.startsWith("[") && f.endsWith("]") ? f.substring(1, f.length() - 1) : f;
        }

        Pattern notePat = Pattern.compile("!([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ\\-]+|\\[[a-zA-Z0-9_ ğüşıöçĞÜŞİÖÇ\\-]+\\])");
        Matcher noteMat = notePat.matcher(raw);
        if (noteMat.find()) {
            String n = noteMat.group(1);
            parsedNote = n.startsWith("[") && n.endsWith("]") ? n.substring(1, n.length() - 1) : n;
        }

        Pattern tagPat = Pattern.compile("#([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)");
        Matcher tagMat = tagPat.matcher(raw);
        while (tagMat.find()) {
            String t = tagMat.group(1).toLowerCase();
            if (!"todo".equals(t)) {
                parsedTags.add(t);
            }
        }

        if (parsedFolder != null) {
            chipFolder.setVisibility(View.VISIBLE);
            chipFolder.setText("📂 Klasör: " + parsedFolder);
        } else {
            chipFolder.setVisibility(View.GONE);
        }

        if (parsedNote != null) {
            chipNote.setVisibility(View.VISIBLE);
            chipNote.setText("📄 Not: " + parsedNote);
        } else {
            chipNote.setVisibility(View.GONE);
        }

        chipTodo.setVisibility(isTodo ? View.VISIBLE : View.GONE);

        if (!parsedTags.isEmpty()) {
            chipTags.setVisibility(View.VISIBLE);
            StringBuilder sb = new StringBuilder("🏷️ ");
            for (int i = 0; i < parsedTags.size(); i++) {
                if (i > 0) sb.append(", ");
                sb.append(parsedTags.get(i));
            }
            chipTags.setText(sb.toString());
        } else {
            chipTags.setVisibility(View.GONE);
        }
    }

    private void saveNoteToFile(String rawInput) {
        parseInput(rawInput);
        
        File rootDir = getNotesRootDir();
        if (rootDir == null) return;

        if (parsedFolder != null) {
            File folderDir = new File(rootDir, parsedFolder);
            if (!folderDir.exists()) {
                folderDir.mkdirs();
            }
        }

        String relPath = "";
        String headerText = "";

        if (parsedFolder != null && parsedNote != null) {
            relPath = parsedFolder + "/" + parsedNote.replace(" ", "_") + ".md";
            headerText = "# " + parsedNote + "\n\n";
        } else if (parsedFolder != null) {
            relPath = parsedFolder + "/inbox.md";
            headerText = "# " + parsedFolder + " Gelen Kutusu\n\n";
        } else if (parsedNote != null) {
            relPath = parsedNote.replace(" ", "_") + ".md";
            headerText = "# " + parsedNote + "\n\n";
        } else {
            relPath = "inbox.md";
            headerText = "# Gelen Kutusu (Inbox)\n\n";
        }

        File targetFile = new File(rootDir, relPath);
        boolean isNewFile = !targetFile.exists();

        Pattern folderPat = Pattern.compile("@([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ/\\-]+|\\[[a-zA-Z0-9_ ğüşıöçĞÜŞİÖÇ/\\-]+\\])");
        Pattern notePat = Pattern.compile("!([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ\\-]+|\\[[a-zA-Z0-9_ ğüşıöçĞÜŞİÖÇ\\-]+\\])");
        Pattern tagPat = Pattern.compile("#([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)");

        String cleanText = rawInput;
        cleanText = folderPat.matcher(cleanText).replaceAll("");
        cleanText = notePat.matcher(cleanText).replaceAll("");
        cleanText = tagPat.matcher(cleanText).replaceAll("");
        cleanText = cleanText.replaceAll("\\s+", " ").trim();

        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US);
        String timeStr = sdf.format(new Date());

        StringBuilder tagsBuilder = new StringBuilder();
        for (String tag : parsedTags) {
            tagsBuilder.append(" #").append(tag);
        }

        StringBuilder contentToAppend = new StringBuilder();
        if (isTodo) {
            contentToAppend.append("\n- [ ] [").append(timeStr).append("] ").append(cleanText).append(tagsBuilder.toString());
        } else {
            contentToAppend.append("\n\n### [").append(timeStr).append("]\n").append(cleanText).append("\n").append(tagsBuilder.toString().trim());
        }

        try {
            if (isNewFile) {
                File parent = targetFile.getParentFile();
                if (parent != null && !parent.exists()) {
                    parent.mkdirs();
                }
                targetFile.createNewFile();
            }
            
            StringBuilder existing = new StringBuilder();
            if (!isNewFile) {
                try (BufferedReader br = new BufferedReader(new FileReader(targetFile))) {
                    String line;
                    while ((line = br.readLine()) != null) {
                        existing.append(line).append("\n");
                    }
                }
            } else {
                existing.append(headerText);
            }

            try (BufferedWriter bw = new BufferedWriter(new FileWriter(targetFile))) {
                bw.write(existing.toString() + contentToAppend.toString());
            }
            
            triggerWidgetRefreshes();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private File getNotesRootDir() {
        File[] rootDirs = new File[]{
            new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(getExternalFilesDir(null), "Documents/UltimateNotes"),
            new File(getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(getFilesDir(), "UltimateNotes"),
            new File(getFilesDir(), "Documents/UltimateNotes")
        };
        for (File rootDir : rootDirs) {
            if (rootDir.exists()) {
                return rootDir;
            }
        }
        rootDirs[0].mkdirs();
        return rootDirs[0];
    }

    private void triggerWidgetRefreshes() {
        Intent taskIntent = new Intent(this, WidgetProvider.class);
        taskIntent.setAction("com.ultimatenotes.app.action.REFRESH");
        sendBroadcast(taskIntent);

        Intent factoryIntent = new Intent(this, NoteFactoryWidgetProvider.class);
        factoryIntent.setAction("com.ultimatenotes.app.action.REFRESH");
        sendBroadcast(factoryIntent);
    }
}
