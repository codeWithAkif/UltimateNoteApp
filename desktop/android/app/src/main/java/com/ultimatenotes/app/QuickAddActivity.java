package com.ultimatenotes.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Environment;
import android.widget.CalendarView;
import android.widget.EditText;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.datepicker.MaterialDatePicker;
import com.google.android.material.datepicker.MaterialPickerOnPositiveButtonClickListener;
import com.google.android.material.timepicker.MaterialTimePicker;
import com.google.android.material.timepicker.TimeFormat;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

public class QuickAddActivity extends AppCompatActivity {
    private String selectedDate = "";
    private String selectedTime = "";
    private String selectedRepeat = "none";
    
    private android.widget.LinearLayout datetimeBadgeContainer;
    private android.widget.TextView tvDatetimeBadge;
    private BottomSheetDialog bottomSheet;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        android.view.View emptyView = new android.view.View(this);
        setContentView(emptyView);

        Intent intent = getIntent();
        final String mode = intent.getStringExtra("mode");
        final int position = intent.getIntExtra("item_position", -1);
        final String initialText = intent.getStringExtra("item_text");

        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        final String pinnedPath = prefs.getString("widget_pinned_list", null);

        if (pinnedPath == null || pinnedPath.trim().isEmpty()) {
            finish();
            return;
        }

        if ("receipt".equals(mode)) {
            bottomSheet = new BottomSheetDialog(this);
            bottomSheet.setContentView(R.layout.dialog_receipt);
            android.widget.FrameLayout bottomSheetLayout = bottomSheet.findViewById(com.google.android.material.R.id.design_bottom_sheet);
            if (bottomSheetLayout != null) {
                bottomSheetLayout.setBackgroundColor(android.graphics.Color.TRANSPARENT);
            }
            if (bottomSheet.getWindow() != null) {
                bottomSheet.getWindow().setSoftInputMode(
                    android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE |
                    android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                );
            }
            bottomSheet.getBehavior().setState(com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED);
            bottomSheet.setOnDismissListener(new android.content.DialogInterface.OnDismissListener() {
                @Override
                public void onDismiss(android.content.DialogInterface dialog) {
                    finish();
                }
            });

            final android.widget.TextView tvItems = bottomSheet.findViewById(R.id.tv_receipt_items);
            final EditText marketInput = bottomSheet.findViewById(R.id.receipt_market_input);
            final EditText amountInput = bottomSheet.findViewById(R.id.receipt_amount_input);
            final android.widget.TextView btnSaveReceipt = bottomSheet.findViewById(R.id.btn_save_receipt);
            final android.widget.Spinner sourceSpinner = bottomSheet.findViewById(R.id.receipt_source_spinner);
            // Taksit seçeneği için arayüz spinner bileşeni
            final android.widget.Spinner installmentSpinner = bottomSheet.findViewById(R.id.receipt_installment_spinner);

            final java.util.List<String> checkedItems = new java.util.ArrayList<>();
            final java.util.List<Integer> checkedLineIndices = new java.util.ArrayList<>();
            final java.util.List<String> rawLines = new java.util.ArrayList<>();

            File file = getNoteFile(pinnedPath);
            if (file != null) {
                try (BufferedReader br = new BufferedReader(new FileReader(file))) {
                    String line;
                    int lineIdx = 0;
                    while ((line = br.readLine()) != null) {
                        rawLines.add(line);
                        String trimmed = line.trim();
                        if (trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]")) {
                            String itemText = trimmed.substring(5).trim();
                            checkedItems.add(itemText);
                            checkedLineIndices.add(lineIdx);
                        }
                        lineIdx++;
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }

            if (!checkedItems.isEmpty()) {
                StringBuilder sb = new StringBuilder("Alınan Ürünler: ");
                for (int i = 0; i < checkedItems.size(); i++) {
                    sb.append(checkedItems.get(i));
                    if (i < checkedItems.size() - 1) sb.append(", ");
                }
                tvItems.setText(sb.toString());
            } else {
                tvItems.setText("Tikli ürün bulunamadı. Lütfen önce listeden ürünleri seçin.");
                btnSaveReceipt.setEnabled(false);
                btnSaveReceipt.setAlpha(0.5f);
            }

            final java.util.List<String> sources = scanFinanceSources();
            android.widget.ArrayAdapter<String> adapter = new android.widget.ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, sources) {
                @Override
                public android.view.View getView(int position, android.view.View convertView, android.view.ViewGroup parent) {
                    android.view.View v = super.getView(position, convertView, parent);
                    if (v instanceof android.widget.TextView) {
                        ((android.widget.TextView) v).setTextColor(0xffffffff);
                        ((android.widget.TextView) v).setTextSize(15);
                    }
                    return v;
                }
                @Override
                public android.view.View getDropDownView(int position, android.view.View convertView, android.view.ViewGroup parent) {
                    android.view.View v = super.getDropDownView(position, convertView, parent);
                    v.setBackgroundColor(0xff1c1c24);
                    if (v instanceof android.widget.TextView) {
                        ((android.widget.TextView) v).setTextColor(0xffffffff);
                        ((android.widget.TextView) v).setTextSize(15);
                        v.setPadding(24, 24, 24, 24);
                    }
                    return v;
                }
            };
            adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            sourceSpinner.setAdapter(adapter);

            // Taksit seçeneklerini listeye ekleme ve spinner'a bağlama
            final java.util.List<String> installments = new java.util.ArrayList<>();
            installments.add("Tek Çekim");
            installments.add("2 Taksit");
            installments.add("3 Taksit");
            installments.add("4 Taksit");
            installments.add("6 Taksit");
            installments.add("9 Taksit");
            installments.add("12 Taksit");

            android.widget.ArrayAdapter<String> instAdapter = new android.widget.ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, installments) {
                @Override
                public android.view.View getView(int position, android.view.View convertView, android.view.ViewGroup parent) {
                    android.view.View v = super.getView(position, convertView, parent);
                    if (v instanceof android.widget.TextView) {
                        ((android.widget.TextView) v).setTextColor(0xffffffff);
                        ((android.widget.TextView) v).setTextSize(15);
                    }
                    return v;
                }
                @Override
                public android.view.View getDropDownView(int position, android.view.View convertView, android.view.ViewGroup parent) {
                    android.view.View v = super.getDropDownView(position, convertView, parent);
                    v.setBackgroundColor(0xff1c1c24);
                    if (v instanceof android.widget.TextView) {
                        ((android.widget.TextView) v).setTextColor(0xffffffff);
                        ((android.widget.TextView) v).setTextSize(15);
                        v.setPadding(24, 24, 24, 24);
                    }
                    return v;
                }
            };
            instAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            installmentSpinner.setAdapter(instAdapter);

            btnSaveReceipt.setOnClickListener(new android.view.View.OnClickListener() {
                @Override
                public void onClick(android.view.View v) {
                    String market = marketInput.getText().toString().trim();
                    String amountStr = amountInput.getText().toString().trim();
                    if (amountStr.isEmpty() || checkedLineIndices.isEmpty()) {
                        return;
                    }

                    File f = getNoteFile(pinnedPath);
                    if (f != null) {
                        java.util.List<String> newLines = new java.util.ArrayList<>();
                        for (int i = 0; i < rawLines.size(); i++) {
                            if (!checkedLineIndices.contains(i)) {
                                newLines.add(rawLines.get(i));
                            }
                        }

                        String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
                        String marketTag = market.isEmpty() ? "" : " @" + market;
                        StringBuilder prods = new StringBuilder();
                        for (int i = 0; i < checkedItems.size(); i++) {
                            prods.append(checkedItems.get(i));
                            if (i < checkedItems.size() - 1) prods.append(", ");
                        }
                        
                        String selectedSource = sourceSpinner.getSelectedItem() != null ? sourceSpinner.getSelectedItem().toString() : "Genel";
                        String sourceTag = "Genel".equals(selectedSource) ? "" : " [kaynak: " + selectedSource + "]";

                        // Taksit seçeneği kontrolü ve etiket oluşturulması
                        String selectedInst = installmentSpinner.getSelectedItem() != null ? installmentSpinner.getSelectedItem().toString() : "Tek Çekim";
                        String instTag = "";
                        if (!"Tek Çekim".equals(selectedInst)) {
                            String digits = selectedInst.replaceAll("\\D+", "");
                            if (!digits.isEmpty()) {
                                instTag = " [taksit: " + digits + "]";
                            }
                        }

                        String receiptLine = "- [harcama: " + amountStr + " TL]" + marketTag + " (" + prods.toString() + ") [" + today + "]" + sourceTag + instTag;
                        newLines.add(receiptLine);

                        try (java.io.BufferedWriter bw = new java.io.BufferedWriter(new java.io.FileWriter(f))) {
                            for (int i = 0; i < newLines.size(); i++) {
                                bw.write(newLines.get(i));
                                if (i < newLines.size() - 1) bw.newLine();
                            }
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }

                    triggerRefresh();
                    bottomSheet.dismiss();
                }
            });

            bottomSheet.show();
            marketInput.requestFocus();
            marketInput.postDelayed(new Runnable() {
                @Override
                public void run() {
                    android.view.inputmethod.InputMethodManager imm = (android.view.inputmethod.InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (imm != null) {
                        imm.showSoftInput(marketInput, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
                    }
                }
            }, 200);
            return;
        }

        bottomSheet = new BottomSheetDialog(this);
        bottomSheet.setContentView(R.layout.dialog_quick_add);
        
        android.widget.FrameLayout bottomSheetLayout = bottomSheet.findViewById(com.google.android.material.R.id.design_bottom_sheet);
        if (bottomSheetLayout != null) {
            bottomSheetLayout.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        }

        bottomSheet.setOnDismissListener(new android.content.DialogInterface.OnDismissListener() {
            @Override
            public void onDismiss(android.content.DialogInterface dialog) {
                finish();
            }
        });

        if (bottomSheet.getWindow() != null) {
            bottomSheet.getWindow().setSoftInputMode(
                android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE |
                android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            );
        }

        final EditText input = bottomSheet.findViewById(R.id.quick_add_input);
        final EditText inputDetail = bottomSheet.findViewById(R.id.quick_add_detail);
        final android.widget.TextView btnSave = bottomSheet.findViewById(R.id.btn_save);
        
        datetimeBadgeContainer = bottomSheet.findViewById(R.id.datetime_badge_container);
        tvDatetimeBadge = bottomSheet.findViewById(R.id.tv_datetime_badge);
        android.widget.TextView btnClearDatetime = bottomSheet.findViewById(R.id.btn_clear_datetime);
        android.widget.ImageView iconClock = bottomSheet.findViewById(R.id.icon_clock);

        final boolean isEditMode = "edit".equals(mode) && position != -1;
        
        String parsedDetail = "";
        if (isEditMode) {
            input.setHint("Maddeyi düzenle");
            if (initialText != null) {
                input.setText(initialText);
                input.setSelection(initialText.length());
                btnSave.setTextColor(0xff38bdf8);
                btnSave.setClickable(true);
            }
            
            File file = getNoteFile(pinnedPath);
            if (file != null) {
                try (BufferedReader br = new BufferedReader(new FileReader(file))) {
                    String line;
                    int currentIndex = 0;
                    while ((line = br.readLine()) != null) {
                        String trimmed = line.trim();
                        if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]") || (trimmed.startsWith("- ") && !trimmed.startsWith("- ["))) {
                            if (currentIndex == position) {
                                java.util.regex.Matcher dueMatcher = java.util.regex.Pattern.compile("\\[due:(\\d{4}-\\d{2}-\\d{2})\\]").matcher(line);
                                if (dueMatcher.find()) {
                                    selectedDate = dueMatcher.group(1);
                                }
                                java.util.regex.Matcher timeMatcher = java.util.regex.Pattern.compile("\\[time:(\\d{2}:\\d{2})-\\d{2}:\\d{2}\\]").matcher(line);
                                if (timeMatcher.find()) {
                                    selectedTime = timeMatcher.group(1);
                                }
                                java.util.regex.Matcher repeatMatcher = java.util.regex.Pattern.compile("\\[repeat:(daily|günlük|weekly|haftalık|monthly|aylık)\\]", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(line);
                                if (repeatMatcher.find()) {
                                    String r = repeatMatcher.group(1).toLowerCase();
                                    if (r.equals("günlük")) selectedRepeat = "daily";
                                    else if (r.equals("haftalık")) selectedRepeat = "weekly";
                                    else if (r.equals("aylık")) selectedRepeat = "monthly";
                                    else selectedRepeat = r;
                                }
                                
                                String nextLine = br.readLine();
                                if (nextLine != null && nextLine.startsWith("  ") && !nextLine.trim().startsWith("- ") && !nextLine.trim().startsWith("* ")) {
                                    parsedDetail = nextLine.trim();
                                }
                                break;
                            }
                            currentIndex++;
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        } else {
            input.setHint("Yeni görev");
        }

        if (!parsedDetail.isEmpty()) {
            inputDetail.setText(parsedDetail);
        }
        
        updateDateTimeBadge();

        btnClearDatetime.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                selectedDate = "";
                selectedTime = "";
                selectedRepeat = "none";
                datetimeBadgeContainer.setVisibility(android.view.View.GONE);
            }
        });

        iconClock.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                showDateTimePickerDialog();
            }
        });

        input.addTextChangedListener(new android.text.TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                String val = s.toString().trim();
                if (!val.isEmpty()) {
                    btnSave.setTextColor(0xff38bdf8);
                    btnSave.setClickable(true);
                } else {
                    btnSave.setTextColor(0xff64748b);
                    btnSave.setClickable(false);
                }
            }

            @Override
            public void afterTextChanged(android.text.Editable s) {}
        });

        btnSave.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                String text = input.getText().toString().trim();
                String detail = inputDetail.getText().toString().trim();
                if (!text.isEmpty()) {
                    if (isEditMode) {
                        editItemInFile(pinnedPath, position, text, detail);
                    } else {
                        addItemToFile(pinnedPath, text, detail);
                    }
                }
                bottomSheet.dismiss();
            }
        });

        inputDetail.setOnEditorActionListener(new android.widget.TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(android.widget.TextView v, int actionId, android.view.KeyEvent event) {
                if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                    String text = input.getText().toString().trim();
                    String detail = inputDetail.getText().toString().trim();
                    if (!text.isEmpty()) {
                        if (isEditMode) {
                            editItemInFile(pinnedPath, position, text, detail);
                        } else {
                            addItemToFile(pinnedPath, text, detail);
                        }
                    }
                    bottomSheet.dismiss();
                    return true;
                }
                return false;
            }
        });

        bottomSheet.show();
        
        input.requestFocus();
        input.postDelayed(new Runnable() {
            @Override
            public void run() {
                android.view.inputmethod.InputMethodManager imm = (android.view.inputmethod.InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) {
                    imm.showSoftInput(input, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
                }
            }
        }, 200);
    }

    private void showDateTimePickerDialog() {
        final android.app.Dialog dialog = new android.app.Dialog(QuickAddActivity.this);
        dialog.setContentView(R.layout.dialog_datetime_picker);
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        }

        final CalendarView calendarView = dialog.findViewById(R.id.dialog_calendar);
        android.widget.RelativeLayout rowSetTime = dialog.findViewById(R.id.row_set_time);
        android.widget.RelativeLayout rowRecurrence = dialog.findViewById(R.id.row_recurrence);
        final android.widget.TextView tvSelectedTime = dialog.findViewById(R.id.tv_selected_time);
        final android.widget.TextView tvSelectedRepeat = dialog.findViewById(R.id.tv_selected_repeat);
        android.widget.TextView btnCancel = dialog.findViewById(R.id.btn_dialog_cancel);
        android.widget.TextView btnDone = dialog.findViewById(R.id.btn_dialog_done);

        final Calendar cal = Calendar.getInstance();
        final String[] tempDate = {selectedDate.isEmpty() ? String.format(Locale.US, "%d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH)) : selectedDate};
        final String[] tempTime = {selectedTime};
        final String[] tempRepeat = {selectedRepeat};

        if (!tempDate[0].isEmpty()) {
            try {
                String[] parts = tempDate[0].split("-");
                cal.set(Calendar.YEAR, Integer.parseInt(parts[0]));
                cal.set(Calendar.MONTH, Integer.parseInt(parts[1]) - 1);
                cal.set(Calendar.DAY_OF_MONTH, Integer.parseInt(parts[2]));
                calendarView.setDate(cal.getTimeInMillis(), true, true);
            } catch (Exception e) {}
        }

        if (!tempTime[0].isEmpty()) {
            tvSelectedTime.setText(tempTime[0]);
        }
        
        if (!tempRepeat[0].isEmpty() && !"none".equals(tempRepeat[0])) {
            if ("daily".equals(tempRepeat[0])) tvSelectedRepeat.setText("Günlük");
            else if ("weekly".equals(tempRepeat[0])) tvSelectedRepeat.setText("Haftalık");
            else if ("monthly".equals(tempRepeat[0])) tvSelectedRepeat.setText("Aylık");
        } else {
            tvSelectedRepeat.setText("Yinelenmiyor");
        }

        calendarView.setOnDateChangeListener(new CalendarView.OnDateChangeListener() {
            @Override
            public void onSelectedDayChange(CalendarView view, int year, int month, int dayOfMonth) {
                tempDate[0] = String.format(Locale.US, "%d-%02d-%02d", year, month + 1, dayOfMonth);
            }
        });

        rowSetTime.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                int hour = cal.get(Calendar.HOUR_OF_DAY);
                int minute = cal.get(Calendar.MINUTE);
                if (!tempTime[0].isEmpty()) {
                    try {
                        String[] parts = tempTime[0].split(":");
                        hour = Integer.parseInt(parts[0]);
                        minute = Integer.parseInt(parts[1]);
                    } catch (Exception e) {}
                }
                
                final MaterialTimePicker timePicker = new MaterialTimePicker.Builder()
                    .setTimeFormat(TimeFormat.CLOCK_24H)
                    .setHour(hour)
                    .setMinute(minute)
                    .setTitleText("Zamanı seçin")
                    .setTheme(com.google.android.material.R.style.ThemeOverlay_MaterialComponents_TimePicker)
                    .build();

                timePicker.addOnPositiveButtonClickListener(new android.view.View.OnClickListener() {
                    @Override
                    public void onClick(android.view.View view) {
                        tempTime[0] = String.format(Locale.US, "%02d:%02d", timePicker.getHour(), timePicker.getMinute());
                        tvSelectedTime.setText(tempTime[0]);
                    }
                });
                timePicker.show(getSupportFragmentManager(), "MATERIAL_TIME_PICKER");
            }
        });

        rowRecurrence.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                showRecurrenceSettingsDialog(tempDate, tempTime, tempRepeat, tvSelectedTime, tvSelectedRepeat);
            }
        });

        btnCancel.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                dialog.dismiss();
            }
        });

        btnDone.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                selectedDate = tempDate[0];
                selectedTime = tempTime[0];
                selectedRepeat = tempRepeat[0];
                
                updateDateTimeBadge();
                dialog.dismiss();
            }
        });

        dialog.show();
    }

    private void showRecurrenceSettingsDialog(
        final String[] parentDate, 
        final String[] parentTime, 
        final String[] parentRepeat, 
        final android.widget.TextView parentTvTime,
        final android.widget.TextView parentTvRepeat
    ) {
        final android.app.Dialog dialog = new android.app.Dialog(QuickAddActivity.this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        dialog.setContentView(R.layout.dialog_recurrence_settings);
        dialog.getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0xff0f172a));

        android.widget.ImageView btnBack = dialog.findViewById(R.id.btn_recurrence_back);
        android.widget.TextView btnDone = dialog.findViewById(R.id.btn_recurrence_done);
        
        final EditText etCount = dialog.findViewById(R.id.et_recurrence_count);
        final android.widget.Spinner spinnerPeriod = dialog.findViewById(R.id.spinner_recurrence_period);
        final android.widget.LinearLayout layoutDays = dialog.findViewById(R.id.layout_recurrence_days);
        
        final android.widget.TextView boxTime = dialog.findViewById(R.id.box_recurrence_time);
        final android.widget.TextView boxStartDate = dialog.findViewById(R.id.box_recurrence_start_date);
        
        final android.widget.RadioGroup rgEnd = dialog.findViewById(R.id.rg_recurrence_end);
        final android.widget.RadioButton rbNever = dialog.findViewById(R.id.rb_end_never);
        final android.widget.RadioButton rbDate = dialog.findViewById(R.id.rb_end_date);
        final android.widget.RadioButton rbCount = dialog.findViewById(R.id.rb_end_count);
        final android.widget.TextView boxEndDate = dialog.findViewById(R.id.box_recurrence_end_date);
        final EditText etEndCount = dialog.findViewById(R.id.et_recurrence_end_count);

        android.widget.ArrayAdapter<String> periodAdapter = new android.widget.ArrayAdapter<>(
            QuickAddActivity.this,
            android.R.layout.simple_spinner_item,
            new String[]{"gün", "hafta", "ay", "yıl"}
        );
        periodAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinnerPeriod.setAdapter(periodAdapter);

        final String[] tempDate = {parentDate[0].isEmpty() ? getTodayStr() : parentDate[0]};
        final String[] tempTime = {parentTime[0]};
        final String[] tempRepeat = {parentRepeat[0]};
        final String[] tempEndDate = {""};
        
        if ("daily".equals(tempRepeat[0])) spinnerPeriod.setSelection(0);
        else if ("weekly".equals(tempRepeat[0])) spinnerPeriod.setSelection(1);
        else if ("monthly".equals(tempRepeat[0])) spinnerPeriod.setSelection(2);
        else spinnerPeriod.setSelection(1);

        if (!tempTime[0].isEmpty()) {
            boxTime.setText(tempTime[0]);
            boxTime.setTextColor(0xfff1f5f9);
        }
        
        boxStartDate.setText(formatDateText(tempDate[0]));

        final int[] dayIds = {R.id.day_mon, R.id.day_tue, R.id.day_wed, R.id.day_thu, R.id.day_fri, R.id.day_sat, R.id.day_sun};
        final boolean[] activeDays = new boolean[7];
        
        Calendar cToday = Calendar.getInstance();
        if (!tempDate[0].isEmpty()) {
            try {
                String[] parts = tempDate[0].split("-");
                cToday.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]));
            } catch (Exception e) {}
        }
        int dayOfWeek = cToday.get(Calendar.DAY_OF_WEEK);
        int normalIdx = (dayOfWeek + 5) % 7;
        activeDays[normalIdx] = true;

        for (int i = 0; i < 7; i++) {
            final int idx = i;
            final android.widget.TextView tvDay = dialog.findViewById(dayIds[i]);
            
            if (activeDays[i]) {
                tvDay.setBackgroundResource(R.drawable.recurrence_day_selected);
                tvDay.setTextColor(0xff0f172a);
            } else {
                tvDay.setBackgroundResource(R.drawable.recurrence_day_unselected);
                tvDay.setTextColor(0xfff1f5f9);
            }

            tvDay.setOnClickListener(new android.view.View.OnClickListener() {
                @Override
                public void onClick(android.view.View v) {
                    activeDays[idx] = !activeDays[idx];
                    if (activeDays[idx]) {
                        tvDay.setBackgroundResource(R.drawable.recurrence_day_selected);
                        tvDay.setTextColor(0xff0f172a);
                    } else {
                        tvDay.setBackgroundResource(R.drawable.recurrence_day_unselected);
                        tvDay.setTextColor(0xfff1f5f9);
                    }
                }
            });
        }

        spinnerPeriod.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent, android.view.View view, int position, long id) {
                if (position == 1) {
                    layoutDays.setVisibility(android.view.View.VISIBLE);
                } else {
                    layoutDays.setVisibility(android.view.View.GONE);
                }
            }
            @Override
            public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });

        boxTime.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                int hour = 12;
                int minute = 0;
                if (!tempTime[0].isEmpty()) {
                    try {
                        String[] parts = tempTime[0].split(":");
                        hour = Integer.parseInt(parts[0]);
                        minute = Integer.parseInt(parts[1]);
                    } catch (Exception e) {}
                }
                
                final MaterialTimePicker timePicker = new MaterialTimePicker.Builder()
                    .setTimeFormat(TimeFormat.CLOCK_24H)
                    .setHour(hour)
                    .setMinute(minute)
                    .setTitleText("Zamanı seçin")
                    .setTheme(com.google.android.material.R.style.ThemeOverlay_MaterialComponents_TimePicker)
                    .build();

                timePicker.addOnPositiveButtonClickListener(new android.view.View.OnClickListener() {
                    @Override
                    public void onClick(android.view.View view) {
                        tempTime[0] = String.format(Locale.US, "%02d:%02d", timePicker.getHour(), timePicker.getMinute());
                        boxTime.setText(tempTime[0]);
                        boxTime.setTextColor(0xfff1f5f9);
                    }
                });
                timePicker.show(getSupportFragmentManager(), "MATERIAL_TIME_PICKER");
            }
        });

        boxStartDate.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                Calendar c = Calendar.getInstance();
                if (!tempDate[0].isEmpty()) {
                    try {
                        String[] parts = tempDate[0].split("-");
                        c.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]));
                    } catch (Exception e) {}
                }
                
                final MaterialDatePicker<Long> datePicker = MaterialDatePicker.Builder.datePicker()
                    .setTitleText("Başlangıç tarihi")
                    .setSelection(c.getTimeInMillis())
                    .build();

                datePicker.addOnPositiveButtonClickListener(new MaterialPickerOnPositiveButtonClickListener<Long>() {
                    @Override
                    public void onPositiveButtonClick(Long selection) {
                        Calendar utcCal = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
                        utcCal.setTimeInMillis(selection);
                        tempDate[0] = String.format(Locale.US, "%d-%02d-%02d", utcCal.get(Calendar.YEAR), utcCal.get(Calendar.MONTH) + 1, utcCal.get(Calendar.DAY_OF_MONTH));
                        boxStartDate.setText(formatDateText(tempDate[0]));
                    }
                });
                datePicker.show(getSupportFragmentManager(), "START_DATE_PICKER");
            }
        });

        boxEndDate.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                if (!rbDate.isChecked()) return;
                
                Calendar c = Calendar.getInstance();
                final MaterialDatePicker<Long> datePicker = MaterialDatePicker.Builder.datePicker()
                    .setTitleText("Bitiş tarihi")
                    .setSelection(c.getTimeInMillis())
                    .build();

                datePicker.addOnPositiveButtonClickListener(new MaterialPickerOnPositiveButtonClickListener<Long>() {
                    @Override
                    public void onPositiveButtonClick(Long selection) {
                        Calendar utcCal = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
                        utcCal.setTimeInMillis(selection);
                        tempEndDate[0] = String.format(Locale.US, "%d-%02d-%02d", utcCal.get(Calendar.YEAR), utcCal.get(Calendar.MONTH) + 1, utcCal.get(Calendar.DAY_OF_MONTH));
                        boxEndDate.setText(formatDateText(tempEndDate[0]));
                        boxEndDate.setTextColor(0xfff1f5f9);
                    }
                });
                datePicker.show(getSupportFragmentManager(), "END_DATE_PICKER");
            }
        });

        rgEnd.setOnCheckedChangeListener(new android.widget.RadioGroup.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(android.widget.RadioGroup group, int checkedId) {
                if (checkedId == R.id.rb_end_never) {
                    boxEndDate.setClickable(false);
                    boxEndDate.setTextColor(0xff94a3b8);
                    etEndCount.setEnabled(false);
                } else if (checkedId == R.id.rb_end_date) {
                    boxEndDate.setClickable(true);
                    boxEndDate.setTextColor(0xfff1f5f9);
                    etEndCount.setEnabled(false);
                } else if (checkedId == R.id.rb_end_count) {
                    boxEndDate.setClickable(false);
                    boxEndDate.setTextColor(0xff94a3b8);
                    etEndCount.setEnabled(true);
                }
            }
        });

        btnBack.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                dialog.dismiss();
            }
        });

        btnDone.setOnClickListener(new android.view.View.OnClickListener() {
            @Override
            public void onClick(android.view.View v) {
                parentDate[0] = tempDate[0];
                parentTime[0] = tempTime[0];
                
                int periodPos = spinnerPeriod.getSelectedItemPosition();
                if (periodPos == 0) parentRepeat[0] = "daily";
                else if (periodPos == 1) parentRepeat[0] = "weekly";
                else if (periodPos == 2) parentRepeat[0] = "monthly";
                else parentRepeat[0] = "none";
                
                if (!parentTime[0].isEmpty()) {
                    parentTvTime.setText(parentTime[0]);
                } else {
                    parentTvTime.setText("Ayarlanmadı");
                }
                
                if (!parentRepeat[0].isEmpty() && !"none".equals(parentRepeat[0])) {
                    if ("daily".equals(parentRepeat[0])) parentTvRepeat.setText("Günlük");
                    else if ("weekly".equals(parentRepeat[0])) parentTvRepeat.setText("Haftalık");
                    else if ("monthly".equals(parentRepeat[0])) parentTvRepeat.setText("Aylık");
                } else {
                    parentTvRepeat.setText("Yinelenmiyor");
                }
                
                dialog.dismiss();
            }
        });

        dialog.show();
    }

    private String getTodayStr() {
        Calendar cal = Calendar.getInstance();
        return String.format(Locale.US, "%d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    private String formatDateText(String dateStr) {
        String[] turkishMonths = {"Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"};
        try {
            String[] parts = dateStr.split("-");
            int month = Integer.parseInt(parts[1]);
            int day = Integer.parseInt(parts[2]);
            return day + " " + turkishMonths[month - 1];
        } catch (Exception e) {
            return dateStr;
        }
    }

    private void updateDateTimeBadge() {
        if (selectedDate.isEmpty()) {
            if (datetimeBadgeContainer != null) {
                datetimeBadgeContainer.setVisibility(android.view.View.GONE);
            }
            return;
        }
        
        String formatted = formatDateText(selectedDate);
        try {
            String[] parts = selectedDate.split("-");
            formatted += " " + parts[0];
        } catch (Exception e) {}

        if (!selectedTime.isEmpty()) {
            formatted += ", " + selectedTime;
        }

        if (!selectedRepeat.isEmpty() && !"none".equals(selectedRepeat)) {
            String repText = "";
            if ("daily".equals(selectedRepeat)) repText = "Günlük";
            else if ("weekly".equals(selectedRepeat)) repText = "Haftalık";
            else if ("monthly".equals(selectedRepeat)) repText = "Aylık";
            
            formatted += " | 🔁 " + repText;
        }
        
        if (tvDatetimeBadge != null && datetimeBadgeContainer != null) {
            tvDatetimeBadge.setText("📅 " + formatted);
            datetimeBadgeContainer.setVisibility(android.view.View.VISIBLE);
        }
    }

    private void addItemToFile(String pinnedPath, String text, String detailText) {
        File file = getNoteFile(pinnedPath);
        if (file == null) return;

        try (BufferedWriter bw = new BufferedWriter(new FileWriter(file, true))) {
            String newTags = "";
            if (!selectedDate.isEmpty()) {
                newTags += " [due:" + selectedDate + "]";
            }
            if (!selectedTime.isEmpty()) {
                String endTime = selectedTime;
                try {
                    String[] timeParts = selectedTime.split(":");
                    int h = Integer.parseInt(timeParts[0]);
                    int m = Integer.parseInt(timeParts[1]);
                    int eh = (h + 1) % 24;
                    endTime = String.format(Locale.US, "%02d:%02d", eh, m);
                } catch (Exception e) {}
                newTags += " [time:" + selectedTime + "-" + endTime + "]";
            }
            if (!selectedRepeat.isEmpty() && !"none".equals(selectedRepeat)) {
                newTags += " [repeat:" + selectedRepeat + "]";
            }
            
            bw.newLine();
            bw.write("- [ ] " + text + newTags);
            if (!detailText.isEmpty()) {
                bw.newLine();
                bw.write("  " + detailText);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        triggerRefresh();
    }

    private void editItemInFile(String pinnedPath, int position, String newText, String detailText) {
        File file = getNoteFile(pinnedPath);
        if (file == null) return;

        List<String> rawLines = new java.util.ArrayList<>();
        try (BufferedReader br = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = br.readLine()) != null) {
                rawLines.add(line);
            }
        } catch (Exception e) {
            e.printStackTrace();
            return;
        }

        List<String> newLines = new java.util.ArrayList<>();
        int currentIndex = 0;
        for (int i = 0; i < rawLines.size(); i++) {
            String line = rawLines.get(i);
            String trimmed = line.trim();
            if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]") || (trimmed.startsWith("- ") && !trimmed.startsWith("- ["))) {
                if (currentIndex == position) {
                    String isCheckedChar = trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]") ? "x" : " ";
                    String bulletPrefix = trimmed.startsWith("- ") && !trimmed.startsWith("- [") ? "- " : "- [" + isCheckedChar + "] ";
                    
                    String newTags = "";
                    if (!selectedDate.isEmpty()) {
                        newTags += " [due:" + selectedDate + "]";
                    }
                    if (!selectedTime.isEmpty()) {
                        String endTime = selectedTime;
                        try {
                            String[] timeParts = selectedTime.split(":");
                            int h = Integer.parseInt(timeParts[0]);
                            int m = Integer.parseInt(timeParts[1]);
                            int eh = (h + 1) % 24;
                            endTime = String.format(Locale.US, "%02d:%02d", eh, m);
                        } catch (Exception e) {}
                        newTags += " [time:" + selectedTime + "-" + endTime + "]";
                    }
                    if (!selectedRepeat.isEmpty() && !"none".equals(selectedRepeat)) {
                        newTags += " [repeat:" + selectedRepeat + "]";
                    }
                    
                    newLines.add(bulletPrefix + newText + newTags);
                    if (!detailText.isEmpty()) {
                        newLines.add("  " + detailText);
                    }
                    
                    if (i + 1 < rawLines.size()) {
                        String nextLine = rawLines.get(i + 1);
                        if (nextLine.startsWith("  ") && !nextLine.trim().startsWith("- ") && !nextLine.trim().startsWith("* ")) {
                            i++;
                        }
                    }
                } else {
                    newLines.add(line);
                }
                currentIndex++;
            } else {
                newLines.add(line);
            }
        }

        try (BufferedWriter bw = new BufferedWriter(new FileWriter(file))) {
            for (int i = 0; i < newLines.size(); i++) {
                bw.write(newLines.get(i));
                if (i < newLines.size() - 1) {
                    bw.newLine();
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        triggerRefresh();
    }

    private File getNoteFile(String pinnedPath) {
        File[] rootDirs = new File[]{
            new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(getExternalFilesDir(null), "Documents/UltimateNotes"),
            new File(getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(getFilesDir(), "UltimateNotes"),
            new File(getFilesDir(), "Documents/UltimateNotes")
        };
        for (File rootDir : rootDirs) {
            File testFile = new File(rootDir, pinnedPath);
            if (testFile.exists() && testFile.isFile()) {
                return testFile;
            }
        }
        return null;
    }

    private void triggerRefresh() {
        Intent refreshIntent = new Intent(this, WidgetProvider.class);
        refreshIntent.setAction("com.ultimatenotes.app.action.REFRESH");
        sendBroadcast(refreshIntent);
    }

    private File getNotesDir() {
        File[] rootDirs = new File[]{
            new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(getExternalFilesDir(null), "Documents/UltimateNotes"),
            new File(getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(getFilesDir(), "UltimateNotes"),
            new File(getFilesDir(), "Documents/UltimateNotes")
        };
        for (File dir : rootDirs) {
            if (dir.exists() && dir.isDirectory()) {
                return dir;
            }
        }
        return rootDirs[0];
    }

    private java.util.List<String> scanFinanceSources() {
        java.util.List<String> sources = new java.util.ArrayList<>();
        sources.add("Genel");
        File notesDir = getNotesDir();
        if (notesDir.exists() && notesDir.isDirectory()) {
            scanDirForSources(notesDir, sources);
        }
        return sources;
    }

    private void scanDirForSources(File dir, java.util.List<String> sources) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) {
                if (!f.getName().startsWith(".")) {
                    scanDirForSources(f, sources);
                }
            } else if (f.isFile() && f.getName().endsWith(".md")) {
                try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(f))) {
                    String line;
                    boolean isSource = false;
                    while ((line = br.readLine()) != null) {
                        if (line.contains("#finans-kaynak") || line.contains("#kaynak")) {
                            isSource = true;
                            break;
                        }
                    }
                    if (isSource) {
                        String name = f.getName().substring(0, f.getName().length() - 3);
                        sources.add(name);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
