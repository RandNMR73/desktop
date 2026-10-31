// Runs in an owned process against the built library. Calendar/time-zone
// changes are process-local; no user defaults, files, or permissions change.
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <math.h>

static NSUInteger checks;
static int (*dateGroup)(double, double, char *, uint32_t);

static void Check(BOOL value, NSString *message) {
  checks++;
  if (!value) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); }
}

static NSDate *Date(NSString *text) {
  return [[NSISO8601DateFormatter new] dateFromString:text];
}

static NSString *Relative(NSDate *date, NSDate *now) {
  NSRelativeDateTimeFormatter *formatter = [NSRelativeDateTimeFormatter new];
  formatter.unitsStyle = NSRelativeDateTimeFormatterUnitsStyleFull;
  // Arc leaves dateTimeStyle at its default.
  return [formatter localizedStringForDate:date relativeToDate:now];
}

static NSDateInterval *Day(NSCalendar *calendar, NSDate *date) {
  NSDate *start;
  NSTimeInterval duration;
  Check([calendar rangeOfUnit:NSCalendarUnitDay startDate:&start interval:&duration forDate:date], @"calendar day interval exists");
  return [[NSDateInterval alloc] initWithStartDate:start duration:duration];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    Check(argc == 2, @"native library path required");
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    Check(library != NULL, @"native library loads");
    dateGroup = dlsym(library, "zen_downloads_date_group");
    Check(dateGroup != NULL, @"date grouping ABI exists");
    NSArray *zones = @[@"UTC", @"America/Los_Angeles", @"America/New_York", @"Asia/Tokyo", @"Pacific/Auckland"];
    NSArray *references = @[@"2026-03-09T07:30:00Z", @"2026-11-02T08:30:00Z", @"2026-01-01T00:00:00Z"];
    for (NSString *zone in zones) {
      [NSTimeZone setDefaultTimeZone:[NSTimeZone timeZoneWithName:zone]];
      for (NSString *text in references) {
        NSDate *now = Date(text);
        NSCalendar *calendar = NSCalendar.currentCalendar;
        NSDateInterval *today = Day(calendar, now);
        NSDateInterval *yesterday = Day(calendar, [today.startDate dateByAddingTimeInterval:-1]);
        NSArray *dates = @[today.startDate, [today.endDate dateByAddingTimeInterval:-1],
          yesterday.startDate, [today.startDate dateByAddingTimeInterval:-1],
          [yesterday.startDate dateByAddingTimeInterval:-1],
          [now dateByAddingTimeInterval:-6 * 86400], [now dateByAddingTimeInterval:-7 * 86400],
          [now dateByAddingTimeInterval:-14 * 86400], [now dateByAddingTimeInterval:-31 * 86400],
          [now dateByAddingTimeInterval:-366 * 86400], [now dateByAddingTimeInterval:7 * 86400]];
        for (NSDate *date in dates) {
          char buffer[1024] = {0};
          int result = dateGroup(date.timeIntervalSince1970 * 1000,
            now.timeIntervalSince1970 * 1000, buffer, sizeof(buffer));
          int expected = ([date compare:today.startDate] != NSOrderedAscending &&
            [date compare:today.endDate] == NSOrderedAscending) ? -1 :
            ([date compare:yesterday.startDate] != NSOrderedAscending &&
            [date compare:today.startDate] == NSOrderedAscending) ? -2 : 1;
          Check(expected > 0 ? result > 0 : result == expected,
            [NSString stringWithFormat:@"calendar bucket %@ %@ %@", zone, text, date]);
          if (expected > 0) Check([@(buffer) isEqual:Relative(date, now)], @"native relative label matches Arc formatter");
        }
        char buffer[1024];
        Check(dateGroup(NAN, now.timeIntervalSince1970 * 1000, buffer, sizeof(buffer)) > 0 &&
          [@(buffer) isEqual:Relative(NSDate.distantPast, now)], @"missing createdAt uses distantPast");
      }
    }
    char tiny[2] = {'x', 'y'};
    Check(dateGroup(0, 1800000000000, tiny, 1) == 0 && tiny[0] == 'x' && tiny[1] == 'y', @"short output buffer is untouched");
    Check(dateGroup(0, NAN, tiny, 2) == 0, @"invalid reference is rejected");
    Check(dateGroup(0, 1800000000000, NULL, 0) == 0, @"null output is rejected");
    printf("{\"checks\":%lu,\"zones\":5,\"referenceDates\":3,\"failures\":[]}\n", checks);
  }
  return 0;
}
